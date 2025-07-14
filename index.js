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
const YES_NO_KEYWORDS = ['yes', 'no', 'yeah', 'ye', 'yup', 'ok', 'okay', 'sure', 'affirmative', 'nah', 'nope', 'negative'];
const HUMAN_KEYWORDS = ['human', 'person', 'agent', 'representative'];
const THANKS_REGEX = /^(thanks?|thank you|thx|ty)\b/;
const REJECTION_PATTERNS = [
  /\b(no[-\s]*thank(?:s| you))\b/,            // “no thank you”, “no-thanks”
  /\b(no[-\s]*stop)\b/,                       // “no stop”
  /\b(stop)\b/,                               // “stop”
  /\b(exit|cancel|nevermind)\b/,              // basic terms
  /\b(take me off (?:your|this) list(?:s)?)\b/,// “take me off your list(s)”
  /\b(leave me (?:alone|off))\b/               // “leave me alone”
];


const userState = {};

const validZipCodes = new Set([
  "98011" /* Bothell */,
  "98012" /* Mill Creek */,
  "98020" /* Edmonds */,
  "98021" /* Bothell */,
  "98026" /* Edmonds */,
  "98028" /* Kenmore */,
  "98033" /* Kirkland */,
  "98034" /* Kirkland */,
  "98036" /* Lynnwood */,
  "98037" /* Lynnwood */,
  "98043" /* Mountlake Terrace */,
  "98072" /* Woodinville */,
  "98087" /* Lynnwood */,
  "98133" /* Seattle (North) */,
  "98155" /* Shoreline */,
  "98201" /* Everett */,
  "98203" /* Everett */,
  "98204" /* Everett */,
  "98208" /* Everett */,
  "98223" /* Arlington */,
  "98229" /* Bellingham (East) */,
  "98232" /* Bow */,
  "98233" /* Burlington */,
  "98235" /* Clearlake */,
  "98238" /* Conway */,
  "98241" /* Darrington */,
  "98244" /* Deming */,
  "98247" /* Everson */,
  "98248" /* Ferndale */,
  "98249" /* Freeland */,
  "98250" /* Friday Harbor */,
  "98252" /* Granite Falls */,
  "98255" /* Hamilton */,
  "98257" /* La Conner */,
  "98258" /* Lake Stevens */,
  "98260" /* Langley */,
  "98263" /* Lyman */,
  "98266" /* Marblemount */,
  "98267" /* Clear Lake */,
  "98270" /* Marysville */,
  "98271" /* Marysville (North) */,
  "98272" /* Monroe */,
  "98273" /* Mount Vernon */,
  "98274" /* Mount Vernon (East) */,
  "98275" /* Mukilteo */,
  "98277" /* Oak Harbor */,
  "98278" /* Oak Harbor (NAS) */,
  "98282" /* Coupeville */,
  "98283" /* Rockport */,
  "98284" /* Sedro-Woolley */,
  "98287" /* Silvana */,
  "98288" /* Skykomish */,
  "98290" /* Snohomish */,
  "98292" /* Stanwood */,
  "98293" /* Startup */,
  "98294" /* Sultan */,
  "98296" /* Snohomish (South) */,
  "98236" /* Clinton */,
  "98260" /* Langley */
]);

const sendText = async (senderId, text) => {
  await fetch(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: senderId },
        message: { text }
      })
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
              buttons: [
                {
                  type: "web_url",
                  url: "https://www.ffexteriorsolutions.com/book-online",
                  title: "📅 Book Now"
                }
              ]
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
  const raw = messageText.trim().toLowerCase();
  const stripped = raw.replace(/[^\w\s]/g, ' ');

  if (REJECTION_PATTERNS.some(rx => rx.test(stripped))) {
    delete userState[senderId];
    return sendText(
      senderId,
      "Understood—I'll close this chat now. If you ever need us, just send a message. Take care!"
    );
  }


  
  const text = messageText.trim().toLowerCase();
  const state = userState[senderId] || {};

  // 1) Collecting contact info
  if (state.step === 'collect_contact') {
    if (THANKS_REGEX.test(text)) return; // ignore a “thanks”
    await sendText(senderId, "Thank you! A person will reach out to you shortly.");
    // keep ZIP around if you want, then mark done
    userState[senderId] = { step: 'handoff_done', zip: state.zip };
    return;
  }

  // 2) After handoff done: ignore one “thanks”, then reset and reprocess
  if (state.step === 'handoff_done') {
    if (THANKS_REGEX.test(text)) return;
    delete userState[senderId];
    // re-enter normal flow on whatever they just said
    return handleMessage(senderId, messageText);
  }

  // 3) Human hand-off trigger
  if (HUMAN_KEYWORDS.some(k => text.includes(k))) {
    userState[senderId] = { step: 'collect_contact', zip: state.zip };
    return sendText(
      senderId,
      "Please provide an email or phone number and a person will reach out to you shortly."
    );
  }

  // 5) No state yet? try service pre‐selection
  if (!state.step) {
    const service = getBestMatch(text, SERVICE_KEYWORDS);
    if (service) {
      userState[senderId] = { step: 'ask_zip', preselectedService: service };
      return sendText(
        senderId,
        `Great, you’re interested in ${service}. First, could you send me your 5-digit ZIP code so I can check our service area?`
      );
    } else {
      return sendText(
        senderId,
        `Sorry, we don’t currently offer “${messageText.trim()}.”`
      );
    }
  }

  // 6) ZIP step
  if (state.step === 'ask_zip') {
    if (!/^\d{5}$/.test(text)) {
      return sendText(
        senderId,
        "Please send a valid 5-digit ZIP code so I can check if we serve your area."
      );
    }
    if (!validZipCodes.has(text)) {
      delete userState[senderId];
      return sendText(
        senderId,
        "Unfortunately, we’re not servicing that area right now. Check back soon!"
      );
    }
    // ZIP ok
    if (state.preselectedService) {
      // skip to repair/replace
      userState[senderId] = {
        step: 'repair_replace',
        zip: text,
        service: state.preselectedService
      };
      return sendText(
        senderId,
        `Perfect! Are you looking to repair or replace your ${state.preselectedService}?`
      );
    } else {
      userState[senderId] = { step: 'initial', zip: text, greeted: false };
      return sendText(
        senderId,
        "Great! What type of service are you looking for? (Fence, Deck, Windows, Doors, Roofing, Gutters)"
      );
    }
  }

  // 7) Main flow
  switch (state.step) {
    case 'initial': {
      const service = getBestMatch(text, SERVICE_KEYWORDS);
      if (service) {
        userState[senderId] = { ...state, service, step: 'repair_replace', greeted: true };
        return sendText(
          senderId,
          `Are you looking to repair or replace your ${service}?`
        );
      }
      return sendText(
        senderId,
        "What type of service are you looking for? (Fence, Deck, Windows, Doors, Roofing, Gutters)"
      );
    }

    case 'repair_replace': {
      const intent = getBestMatch(text, ['repair', 'replace']);
      if (!intent) {
        return sendText(senderId, "Please type either 'repair' or 'replace'.");
      }

      const { service } = state;
      const nextState = { ...state, intent };

      if (intent === 'repair') {
        if (['windows','doors','deck','roofing','gutters'].includes(service)) {
          delete userState[senderId];
          return sendText(
            senderId,
            `Unfortunately, we do not offer ${service} repairs at this time.`
          );
        }
        if (service === 'fence') {
          userState[senderId] = { ...nextState, step: 'fence_repair_confirm' };
          return sendText(
            senderId,
            "Fence repairs start at a $849 minimum. Would you like to proceed? (Yes/No)"
          );
        }
      } else { // replace
        switch (service) {
          case 'windows':
          case 'doors':
          case 'deck':
          case 'fence':
          case 'gutters':
            return sendBookingButton(senderId);
          case 'roofing':
            userState[senderId] = { ...nextState, step: 'roof_type' };
            return sendText(
              senderId,
              "What type of roofing material are you looking for? (Asphalt, Metal, Cedar Shingles)"
            );
        }
      }
      break;
    }

    case 'fence_repair_confirm': {
      const decision = interpretYesNo(text);
      if (decision === 'yes') {
        return sendBookingButton(senderId);
      } else if (decision === 'no') {
        delete userState[senderId];
        return sendText(
          senderId,
          "No worries! Let us know if you change your mind."
        );
      } else {
        return sendText(
          senderId,
          "Just to confirm, would you like to proceed with the $849 minimum fence repair? (Yes/No)"
        );
      }
    }

    case 'roof_type': {
      const roofType = getBestMatch(text, ['asphalt','metal','cedar shingle']);
      if (roofType === 'cedar shingle') {
        userState[senderId] = { ...state, step: 'cedar_reject' };
        return sendText(
          senderId,
          "We currently don't offer cedar shingle installations, but we'd be happy to replace them with asphalt or metal roofing. Would you like to proceed? (Yes/No)"
        );
      }
      return sendBookingButton(senderId);
    }

    case 'cedar_reject': {
      const decision = interpretYesNo(text);
      if (decision === 'yes') {
        return sendBookingButton(senderId);
      } else if (decision === 'no') {
        delete userState[senderId];
        return sendText(
          senderId,
          "No problem. Let us know if you ever need help with anything else!"
        );
      } else {
        return sendText(
          senderId,
          "Would you like to move forward with asphalt or metal instead? (Yes/No)"
        );
      }
    }
  }
};

app.get('/', (req, res) => res.send('Messenger bot is running'));

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  if (req.body.object !== 'page') return res.sendStatus(404);

  for (const entry of req.body.entry) {
    const event = entry.messaging[0];
    const senderId = event.sender?.id;
    if (!senderId) continue;

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

