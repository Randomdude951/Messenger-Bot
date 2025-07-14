const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const stringSimilarity = require('string-similarity');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

app.use(bodyParser.json());

const SERVICE_KEYWORDS = ['fence', 'deck', 'windows', 'doors', 'roofing', 'gutters'];
const YES_NO_KEYWORDS     = ['yes', 'no', 'yeah', 'ye', 'yup', 'ok', 'okay', 'sure', 'affirmative', 'nah', 'nope', 'negative'];
const HUMAN_KEYWORDS      = ['human', 'person', 'agent', 'representative'];
const THANKS_REGEX        = /^(thanks?|thank you|thx|ty)\b/;

// very flexible “end the chat” detection
const REJECTION_PATTERNS = [
  /\b(no[-\s]*thank(?:s| you))\b/,
  /\b(no[-\s]*stop)\b/,
  /\b(stop)\b/,
  /\b(exit|cancel|nevermind)\b/,
  /\b(take me off (?:your|this) list(?:s)?)\b/,
  /\b(leave me (?:alone|off))\b/
];

// broad pricing-intent detection, excluding time-related asks
const PRICE_PATTERNS = [
  /\bhow much\b.*\b(?:cost|price)\b/,
  /\bwhat(?:'s| is)\s+(?:the\s*)?(?:cost|price)\b/,
  /\b(?:cost|price)\b/
];

const userState = {};

const validZipCodes = new Set([
  "98011","98012","98020","98021","98026","98028","98033","98034","98036","98037",
  "98043","98072","98087","98133","98155","98201","98203","98204","98208","98223",
  "98229","98232","98233","98235","98238","98241","98244","98247","98248","98249",
  "98250","98252","98255","98257","98258","98260","98263","98266","98267","98270",
  "98271","98272","98273","98274","98275","98277","98278","98282","98283","98284",
  "98287","98288","98290","98292","98293","98294","98296","98236"
]);

const sendText = async (senderId, text) => {
  await fetch(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: senderId }, message: { text } })
    }
  );
};

const sendBookingButton = async (senderId) => {
  await fetch(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: senderId },
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "button",
              text: "Perfect! Just click the link to book your free consultation, and we’ll follow up with a quick confirmation call.",
              buttons: [{ type: "web_url", url: "https://www.ffexteriorsolutions.com/book-online", title: "📅 Book Now" }]
            }
          }
        }
      })
    }
  );
  delete userState[senderId];
};

const getBestMatch = (input, options) => {
  const match = stringSimilarity.findBestMatch(input.trim().toLowerCase(), options);
  return match.bestMatch.rating > 0.4 ? match.bestMatch.target : null;
};

const interpretYesNo = (input) => {
  const resp = getBestMatch(input, YES_NO_KEYWORDS);
  if (!resp) return null;
  return ['yes','yeah','ye','yup','ok','okay','sure','affirmative'].includes(resp)
    ? 'yes'
    : ['no','nah','nope','negative'].includes(resp)
      ? 'no'
      : null;
};

const handleMessage = async (senderId, messageText) => {
  // normalize
  const raw      = messageText.trim().toLowerCase();
  const stripped = raw.replace(/[^\w\s]/g, ' ');

  // 0) catch any “end chat” intent
  if (REJECTION_PATTERNS.some(rx => rx.test(stripped))) {
    delete userState[senderId];
    return sendText(senderId, "Understood—I'll close this chat now. If you ever need us again, just send a message. Take care!");
  }

  const text  = raw;
  const state = userState[senderId] || {};

  // 1) collecting contact info
  if (state.step === 'collect_contact') {
    if (THANKS_REGEX.test(text)) return; // ignore a “thanks”
    await sendText(senderId, "Thank you! A person will reach out to you shortly.");
    userState[senderId] = { step: 'handoff_done', zip: state.zip };
    return;
  }

  // 2) after handoff done: ignore one “thanks”, then reset and reprocess
  if (state.step === 'handoff_done') {
    if (THANKS_REGEX.test(text)) return;
    delete userState[senderId];
    return handleMessage(senderId, messageText);
  }

  // 3) human hand-off trigger
  if (HUMAN_KEYWORDS.some(k => text.includes(k))) {
    userState[senderId] = { step: 'collect_contact', zip: state.zip };
    return sendText(senderId, "Please provide an email or phone number and a person will reach out to you shortly.");
  }

  // 4) pricing intent branch (exclude time questions)
  const isPriceQuestion = PRICE_PATTERNS.some(rx => rx.test(raw));
  const isTimeQuestion  = /\btime\b/.test(raw);
  if (isPriceQuestion && !isTimeQuestion) {
    if (text.includes('fence')) {
      return sendText(senderId, "Fence repairs start at a $849 minimum. For an exact estimate we offer a free consultation—would you like our booking link?");
    } else {
      return sendText(senderId, "Pricing varies based on project specifics. We offer a free, no-obligation consultation to give you an accurate quote—shall I send you our booking link?");
    }
  }

  // 5) no state yet? try service + intent pre-selection
  if (!state.step) {
    let service = getBestMatch(text, SERVICE_KEYWORDS) || SERVICE_KEYWORDS.find(k => text.includes(k));
    let intent  = getBestMatch(text, ['repair','replace'])  || ['repair','replace'].find(w => text.includes(w));

    if (service) {
      const newState = { step: 'ask_zip', preselectedService: service };
      let prompt;
      if (intent) {
        newState.preselectedIntent = intent;
        prompt = `Got it—you want to ${intent} your ${service}. First, could you send me your 5-digit ZIP code so I can check our service area?`;
      } else {
        prompt = `Great, you’re interested in ${service}. First, could you send me your 5-digit ZIP code so I can check our service area?`;
      }
      userState[senderId] = newState;
      return sendText(senderId, prompt);
    } else {
      return sendText(senderId, `Sorry, we don’t currently offer “${messageText.trim()}.”`);
    }
  }

  // 6) ZIP code step
  if (state.step === 'ask_zip') {
    if (!/^\d{5}$/.test(text)) {
      return sendText(senderId, "Please send a valid 5-digit ZIP code so I can check if we serve your area.");
    }
    if (!validZipCodes.has(text)) {
      delete userState[senderId];
      return sendText(senderId, "Unfortunately, we’re not servicing that area right now. Check back soon!");
    }

    const svc    = state.preselectedService;
    const intent = state.preselectedIntent;

    // handle if they pre-specified both service and intent
    if (svc) {
      if (intent === 'repair') {
        if (svc === 'fence') {
          userState[senderId] = { step: 'fence_repair_confirm', zip: text, service: svc };
          return sendText(senderId, "Fence repairs start at a $849 minimum. Would you like to proceed? (Yes/No)");
        } else {
          delete userState[senderId];
          return sendText(senderId, `Unfortunately, we do not offer ${svc} repairs at this time.`);
        }
      }
      if (intent === 'replace') {
        if (svc === 'roofing') {
          userState[senderId] = { step: 'roof_type', zip: text, service: svc };
          return sendText(senderId, "What type of roofing material are you looking for? (Asphalt, Metal, Cedar Shingles)");
        } else {
          return sendBookingButton(senderId);
        }
      }
      // no intent? fall through
    }

    // standard flow: ask repair or replace
    userState[senderId] = { step: 'repair_replace', zip: text, service: svc };
    return sendText(senderId, `Perfect! Are you looking to repair or replace your ${svc}?`);
  }

  // 7) main conversation flow
  switch (state.step) {
    case 'repair_replace': {
      const intent = getBestMatch(text, ['repair', 'replace']);
      if (!intent) return sendText(senderId, "Please type either 'repair' or 'replace'.");

      const { service } = state;
      const nextState   = { service, intent };

      if (intent === 'repair') {
        if (service === 'fence') {
          userState[senderId] = { ...nextState, step: 'fence_repair_confirm' };
          return sendText(senderId, "Fence repairs start at a $849 minimum. Would you like to proceed? (Yes/No)");
        } else {
          delete userState[senderId];
          return sendText(senderId, `Unfortunately, we do not offer ${service} repairs at this time.`);
        }
      } else {
        if (service === 'roofing') {
          userState[senderId] = { ...nextState, step: 'roof_type' };
          return sendText(senderId, "What type of roofing material are you looking for? (Asphalt, Metal, Cedar Shingles)");
        } else {
          return sendBookingButton(senderId);
        }
      }
    }

    case 'fence_repair_confirm': {
      const decision = interpretYesNo(text);
      if (decision === 'yes')                  return sendBookingButton(senderId);
      else if (decision === 'no') { delete userState[senderId]; return sendText(senderId, "No worries! Let us know if you change your mind."); }
      else                                     return sendText(senderId, "Just to confirm, would you like to proceed with the $849 minimum fence repair? (Yes/No)");
    }

    case 'roof_type': {
      const roofType = getBestMatch(text, ['asphalt','metal','cedar shingle']);
      if (roofType === 'cedar shingle') {
        userState[senderId] = { ...state, step: 'cedar_reject' };
        return sendText(senderId, "We currently don't offer cedar shingle installations, but we'd be happy to replace them with asphalt or metal roofing. Would you like to proceed? (Yes/No)");
      }
      return sendBookingButton(senderId);
    }

    case 'cedar_reject': {
      const decision = interpretYesNo(text);
      if (decision === 'yes')                  return sendBookingButton(senderId);
      else if (decision === 'no') { delete userState[senderId]; return sendText(senderId, "No problem. Let us know if you ever need help with anything else!"); }
      else                                     return sendText(senderId, "Would you like to move forward with asphalt or metal instead? (Yes/No)");
    }

    default:
      delete userState[senderId];
      return sendText(senderId, "Oops, something went wrong. Let's start over—what service can I help you with?");
  }
};

app.get('/', (req, res) => res.send('Messenger bot is running'));

app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  if (req.body.object !== 'page') return res.sendStatus(404);

  for (const entry of req.body.entry) {
    const event    = entry.messaging[0];
    const senderId = event.sender?.id;
    if (!senderId) continue;

    // skip FB ice-breaker quick replies
    if (event.message?.quick_reply) continue;

    // handle Get Started
    if (event.postback?.payload === "GET_STARTED") {
      userState[senderId] = { step: "ask_zip" };
      await sendText(
        senderId,
        "Hi! Before we begin, could you tell me your ZIP code so I can check if you're in our service area?"
      );
      continue;
    }

    if (event.message?.text) {
      await handleMessage(senderId, event.message.text);
    }
  }

  res.sendStatus(200);
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));


