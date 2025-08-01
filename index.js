const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const stringSimilarity = require('string-similarity');
require('dotenv').config();

// App setup
const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
app.use(bodyParser.json());

// Keywords and patterns
const SERVICE_KEYWORDS = ['fence', 'deck', 'windows', 'doors', 'roofing', 'gutters'];
const YES_NO_KEYWORDS = ['yes','no','yeah','ye','yup','ok','okay','sure','affirmative','nah','nope','negative'];
const HUMAN_KEYWORDS = ['human','person','agent','representative'];
const CONTACT_KEYWORDS = ['contact','support','help','phone','email'];
const THANKS_REGEX = /^(thanks?|thank you|thx|ty)\b/;
const REJECTION_PATTERNS = [
  /\b(no[-\s]*thank(?:s| you))\b/,
  /\b(no[-\s]*stop)\b/,
  /\b(stop)\b/,
  /\b(exit|cancel|nevermind)\b/,
  /\b(take me off (?:your|this) list(?:s)?)\b/,
  /\b(leave me (?:alone|off))\b/,
  /\bno more\b/,
  /\b(exit|cancel|nevermind|stop)\b/i,
  /\b(take me off (?:your|this) list(?:s)?)\b/i,
  /\b(leave me (?:alone|off))\b/i,
  /\bno more\b/i,
  /\b(not\s+interested|not\s+now|not\s+looking|no\s+thanks?|no\s+thank\s+you|nah\s*(i'?m)?\s*good|maybe\s+later|i'?m\s+all\s+set)\b/i
];
const PRICE_PATTERNS = [
  /\bhow much\b.*\b(?:cost|price)\b/,
  /\bwhat(?:'s| is)\s+(?:the\s*)?(?:cost|price)\b/,
  /\b(?:cost|price)\b/
];
const AFFIRMATION_PATTERNS = [ /\b(fine|sounds good|works for me|that's fine|thats fine|alright)\b/ ];
const GREETING_PATTERN = /\b(hi|hello|hey)\b/;

// State and ZIP codes
const userState = {};
const validZipCodes = new Set([
  '98011','98012','98020','98021','98026','98028','98033','98034','98036','98037',
  '98043','98072','98087','98133','98155','98201','98203','98204','98208','98223',
  '98229','98232','98233','98235','98238','98241','98244','98247','98248','98249',
  '98250','98252','98255','98257','98258','98260','98263','98266','98267','98270',
  '98271','98272','98273','98274','98275','98277','98278','98282','98283','98284',
  '98287','98288','98290','98292','98293','98294','98296','98236'
]);

// Helpers
const sendText = async (sid, text) => {
  await fetch(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: sid },
        message: { text }
      })
    }
  );
};

const sendBookingButton = async sid => {
  await fetch(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: sid },
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'button',
              text: 'Perfect! Click below to book your free consultation.',
              buttons: [
                { type: 'web_url', url: 'https://www.ffexteriorsolutions.com/book-online', title: '📅 Book Now' }
              ]
            }
          }
        }
      })
    }
  );
  delete userState[sid];
};

const getBestMatch = (inpt, opts) => {
  const m = stringSimilarity.findBestMatch(inpt.trim().toLowerCase(), opts);
  return m.bestMatch.rating > 0.4 ? m.bestMatch.target : null;
};

const interpretYesNo = inpt => {
  const r = getBestMatch(inpt, YES_NO_KEYWORDS);
  return r
    ? (YES_NO_KEYWORDS.slice(0, 8).includes(r) ? 'yes' : 'no')
    : null;
};

// Core handler
const handleMessage = async (sid, message) => {
  const raw = message.trim().toLowerCase();
  const stripped = raw.replace(/[^\w\s]/g, ' ');
  let state = userState[sid] || {};

  // 0) Direct contact‐info requests
  if (CONTACT_KEYWORDS.some(k => raw.includes(k))) {
    delete userState[sid];
    return sendText(
      sid,
      "We can be reached at (360) 506-2071. You can also email ffextsolutions@gmail.com with any questions."
    );
  }

  // 1) Exit / rejection — silently swallow
  if (REJECTION_PATTERNS.some(rx => rx.test(stripped))) {
    delete userState[sid];
    return;
  }

  // 2) Greeting with optional pre-service and pre-intent
  if (!state.step && GREETING_PATTERN.test(raw)) {
    let svc = getBestMatch(raw, SERVICE_KEYWORDS) ||
              SERVICE_KEYWORDS.find(s => raw.includes(s));
    let intent =
      getBestMatch(raw, ['repair', 'replace', 'fix']) ||
      ['repair', 'replace', 'fix'].find(w => raw.includes(w));
    if (intent === 'fix') intent = 'repair';

    userState[sid] = { step: 'ask_zip', preService: svc, preIntent: intent };
    return sendText(
      sid,
      'Please send your 5-digit ZIP code so I can check if you\'re in our area.'
    );
  }

  // 3) Contact collection after human handoff
  if (state.step === 'collect_contact') {
    if (!THANKS_REGEX.test(raw)) {
      await sendText(sid, 'Thank you! Someone will reach out shortly.');
    }
    userState[sid] = { step: 'handoff_done', zip: state.zip };
    return;
  }

  // 4) Post-handoff: ignore one "thanks", then reset and reprocess
  if (state.step === 'handoff_done') {
    if (!THANKS_REGEX.test(raw)) {
      delete userState[sid];
      return handleMessage(sid, message);
    }
    return;
  }

  // 5) Human handoff trigger
  if (HUMAN_KEYWORDS.some(k => raw.includes(k))) {
    userState[sid] = { step: 'collect_contact', zip: state.zip };
    return sendText(sid, 'Please share your email or phone number, and we’ll contact you soon.');
  }

  // 6) Pricing inquiries
  const isPrice = PRICE_PATTERNS.some(rx => rx.test(raw));
  const isTime = /\btime\b/.test(raw);
  if (isPrice && !isTime) {
    if (raw.includes('fence')) {
      return sendText(sid, 'Fence repairs start at $849 min. ZIP for quote?');
    }
    return sendText(sid, 'Pricing varies—shall I send consultation link?');
  }

  // 7) Pre-selection if no state yet
  if (!state.step) {
    let svc = getBestMatch(raw, SERVICE_KEYWORDS) ||
              SERVICE_KEYWORDS.find(s => raw.includes(s));
    let intent =
      getBestMatch(raw, ['repair', 'replace', 'fix']) ||
      ['repair', 'replace', 'fix'].find(w => raw.includes(w));
    if (intent === 'fix') intent = 'repair';

    if (svc) {
      userState[sid] = { step: 'ask_zip', preService: svc, preIntent: intent };
      const pfx = intent
        ? `Got it!.`
        : `Great!.`;
      return sendText(sid, `${pfx} Please send your 5-digit ZIP code.`);
    }

    // fallback: prompt service choice
    userState[sid] = { step: 'initial', zip: state.zip };
    return sendText(
      sid,
      'Hi! What type of service are you looking for? (Fence, Deck, Windows, Doors, Roofing, Gutters)'
    );
  }

  // 8) ZIP validation (extract digits anywhere)
  if (state.step === 'ask_zip') {
    const zipMatch = raw.match(/\b(\d{5})\b/);
    if (!zipMatch) {
      return sendText(sid, 'Please send a valid 5‑digit ZIP code.');
    }
    const zip = zipMatch[1];
    if (!validZipCodes.has(zip)) {
      userState[sid] = { ...state, step: 'ask_zip' };
      return sendText(sid, 'Unfortunately, we don\'t service your area yet.');
    }

    // ZIP is valid—remember it
    const service = state.preService;
    let intent = state.preIntent;
    state.zip = zip;

    // **NEW**: if fence + no intent, ask repair vs replace
    if (service === 'fence' && !intent) {
      userState[sid] = { step: 'repair_replace', service: 'fence', zip };
      return sendText(sid, 'You mentioned a fence—are you looking to repair or replace it?');
    }

    // otherwise if service but no intent, default to replace
    if (service) {
      if (!intent) intent = 'replace';

      if (intent === 'repair') {
        if (service === 'fence') {
          userState[sid] = { step: 'fence_confirm', service, zip };
          return sendText(sid, 'Fence repairs start at $849 – proceed?');
        }
        delete userState[sid];
        return sendText(sid, `We don't repair ${service}.`);
      } else {
        if (service === 'roofing') {
          userState[sid] = { step: 'roof_type', service, zip };
          return sendText(sid, 'Which roofing material? (Asphalt, Metal, Cedar Shingle)');
        }
        return sendBookingButton(sid);
      }
    }

    // no preService: normal next step
    userState[sid] = { step: 'initial', zip };
    return sendText(
      sid,
      'Great! What type of service are you looking for? (Fence, Deck, Windows, Doors, Roofing, Gutters)'
    );
  }

  // 9) Main conversation branches
  switch (state.step) {
    case 'initial': {
      const service = getBestMatch(raw, SERVICE_KEYWORDS);
      if (service) {
        userState[sid] = { ...state, service, step: 'repair_replace' };
        return sendText(sid, `Are you looking to repair or replace your ${service}?`);
      }
      return sendText(
        sid,
        'What type of service are you looking for? (Fence, Deck, Windows, Doors, Roofing, Gutters)'
      );
    }

    case 'repair_replace': {
      let intent =
        getBestMatch(raw, ['repair', 'replace', 'fix']) ||
        ['repair', 'replace', 'fix'].find(w => raw.includes(w));
      if (intent === 'fix') intent = 'repair';
      if (!intent) {
        return sendText(sid, "Type 'repair' or 'replace'.");
      }

      const svc = state.service;
      if (intent === 'repair') {
        if (svc === 'fence') {
          userState[sid] = { step: 'fence_confirm', service: 'fence', zip: state.zip };
          return sendText(sid, 'Fence repairs start at $849 – proceed? (Yes/No)');
        }
        delete userState[sid];
        return sendText(sid, `We don't repair ${svc}.`);
      }

      // replace
      if (svc === 'roofing') {
        userState[sid] = { step: 'roof_type', service: 'roofing', zip: state.zip };
        return sendText(sid, 'Which roofing material? (Asphalt, Metal, Cedar Shingle)');
      }
      return sendBookingButton(sid);
    }

    case 'fence_confirm': {
      const dec = interpretYesNo(raw);
      const aff = AFFIRMATION_PATTERNS.some(rx => rx.test(stripped));
      if (dec === 'yes' || aff) return sendBookingButton(sid);
      if (dec === 'no') {
        delete userState[sid];
        return sendText(sid, 'No worries! If you change your mind or need anything else just send us a message. Take care!');
      }
      return sendText(sid, 'Proceed with $849+ fence repair? (Yes/No)');
    }

    case 'roof_type': {
      const mat = getBestMatch(raw, ['asphalt', 'metal', 'cedar shingle']);
      if (mat === 'cedar shingle') {
        userState[sid] = { step: 'cedar_reject', zip: state.zip };
        return sendText(
          sid,
          "Unfortunately, we don’t offer cedar. Would you like to proceed with asphalt or metal? (Yes/No)"
        );
      }
      return sendBookingButton(sid);
    }

    case 'cedar_reject': {
      const dec = interpretYesNo(raw);
      if (dec === 'yes') return sendBookingButton(sid);
      if (dec === 'no') {
        delete userState[sid];
        return sendText(sid, 'Okay!');
      }
      return sendText(sid, 'Proceed with asphalt/metal? (Yes/No)');
    }

    default: {
      delete userState[sid];
      return sendText(sid, "Something went wrong—let’s start over.");
    }
  }
};

// Webhook endpoints
app.get('/', (req, res) => res.send('Bot running'));
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'],
        token = req.query['hub.verify_token'],
        challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  if (req.body.object !== 'page') return res.sendStatus(404);

  for (const entry of req.body.entry) {
    const msg = entry.messaging[0];
    const sid = msg.sender?.id;
    if (!sid) continue;

    if (msg.postback?.payload === 'GET_STARTED') {
      userState[sid] = { step: 'ask_zip' };
      await sendText(sid, 'Hi! Please send your 5-digit ZIP code.');
      continue;
    }

    if (msg.message?.text) {
      await handleMessage(sid, msg.message.text);
    }
  }

  res.sendStatus(200);
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
