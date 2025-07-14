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
const YES_NO_KEYWORDS = ['yes', 'no', 'yeah', 'ye', 'yup', 'ok', 'okay', 'sure', 'affirmative', 'nah', 'nope', 'negative'];
const HUMAN_KEYWORDS = ['human', 'person', 'agent', 'representative'];
const THANKS_REGEX = /^(thanks?|thank you|thx|ty)\b/;
const REJECTION_PATTERNS = [
  /\b(no[-\s]*thank(?:s| you))\b/, /\b(no[-\s]*stop)\b/, /\b(stop)\b/, /\b(exit|cancel|nevermind)\b/,
  /\b(take me off (?:your|this) list(?:s)?)\b/, /\b(leave me (?:alone|off))\b/
];
const PRICE_PATTERNS = [
  /\bhow much\b.*\b(?:cost|price)\b/, /\bwhat(?:'s| is)\s+(?:the\s*)?(?:cost|price)\b/, /\b(?:cost|price)\b/
];
const AFFIRMATION_PATTERNS = [ /\b(fine|sounds good|works for me|that's fine|thats fine)\b/ ];
const GREETING_PATTERN = /\b(hi|hello|hey)\b/;

// State storage and ZIP codes
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
const sendText = async (senderId, text) => {
  await fetch(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient: { id: senderId }, message: { text } }) }
  );
};

const sendBookingButton = async (senderId) => {
  await fetch(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: senderId },
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'button',
              text: 'Perfect! Click below to book your free consultation.',
              buttons: [{ type: 'web_url', url: 'https://www.ffexteriorsolutions.com/book-online', title: '📅 Book Now' }]
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
  return resp ? (YES_NO_KEYWORDS.slice(0, 8).includes(resp) ? 'yes' : 'no') : null; // treat first half as yes
};

// Core handler
const handleMessage = async (senderId, message) => {
  const raw = message.trim().toLowerCase();
  const stripped = raw.replace(/[^\w\s]/g, ' ');
  let state = userState[senderId] || {};

  // 0) Catch exit phrases
  if (REJECTION_PATTERNS.some(rx => rx.test(stripped))) {
    delete userState[senderId];
    return sendText(senderId, 'Understood—closing chat.');
  }

    // 0a) Greeting or greeting+service reset
  if (!state.step && GREETING_PATTERN.test(raw)) {
    // detect service and optional intent in the same greeting
    let svc    = getBestMatch(raw, SERVICE_KEYWORDS)
              || SERVICE_KEYWORDS.find(s => raw.includes(s));
    let intent = getBestMatch(raw, ['repair','replace','fix'])
              || ['repair','replace','fix'].find(w => raw.includes(w));
    if (intent === 'fix') intent = 'repair';

    const newState = { step: 'ask_zip' };
    if (svc)     newState.preService = svc;
    if (intent)  newState.preIntent  = intent;
    userState[senderId] = newState;

    const greetingText = svc
      ? `Hi! You’d like to ${intent||'get'} your ${svc}. First, send your 5-digit ZIP code.`
      : `Hi! Before we begin, send your 5-digit ZIP code so I can check our service area.`;
    return sendText(senderId, greetingText);
  }


  // 1) Contact collection
  if (state.step === 'collect_contact') {
    if (!THANKS_REGEX.test(raw)) await sendText(senderId, 'Thank you! Someone will reach out shortly.');
    userState[senderId] = { step: 'handoff_done', zip: state.zip };
    return;
  }

  // 2) Post-handoff ignore
  if (state.step === 'handoff_done') {
    if (!THANKS_REGEX.test(raw)) { delete userState[senderId]; return handleMessage(senderId, message); }
    return;
  }

  // 3) Human request
  if (HUMAN_KEYWORDS.some(k => raw.includes(k))) {
    userState[senderId] = { step: 'collect_contact', zip: state.zip };
    return sendText(senderId, 'Please share email or phone, and we’ll have someone contact you.');
  }

  // 4) Pricing inquiry
  const isPrice = PRICE_PATTERNS.some(rx => rx.test(raw));
  const isTime = /\btime\b/.test(raw);
  if (isPrice && !isTime) {
    if (raw.includes('fence')) return sendText(senderId, 'Fence repairs start at $849 min. Send ZIP for quote?');
    return sendText(senderId, 'Pricing varies—shall I send our consultation link?');
  }

  // 5) Pre-service selection
  if (!state.step) {
    let service = getBestMatch(raw, SERVICE_KEYWORDS) || SERVICE_KEYWORDS.find(s => raw.includes(s));
    let intent = getBestMatch(raw, ['repair','replace','fix', 'new']);
    if (!intent) intent = ['repair','replace','fix'].find(w => raw.includes(w));
    if (intent === 'fix') intent = 'repair';
    if (intent === 'new') intent = 'replace';

    if (service) {
      userState[senderId] = { step: 'ask_zip', preService: service, preIntent: intent };
      const prefix = intent ? `Great!` : `Great!`;
      return sendText(senderId, `${prefix} To see if we service your area, please send your 5-digit ZIP code.`);
    }

    return sendText(senderId, `Sorry, we don't offer "${message}".`);
  }

  // 6) ZIP validation
  if (state.step === 'ask_zip') {
    if (!/^\d{5}$/.test(raw)) return sendText(senderId, 'Please send a valid 5-digit ZIP code.');
    if (!validZipCodes.has(raw)) { delete userState[senderId]; return sendText(senderId, 'We’re not in your area yet.'); }

    const { preService, preIntent } = userState[senderId];
    if (!preService) { userState[senderId] = { step: 'initial', zip: raw }; return sendText(senderId, 'What service do you need?'); }

    // jump to repair/replace with preselected intent
    if (preIntent === 'repair') {
      if (preService === 'fence') userState[senderId] = { step: 'fence_confirm', service: preService };
      else { delete userState[senderId]; return sendText(senderId, `We don't repair ${preService}.`); }
      return sendText(senderId, 'Fence repairs start at $849 – proceed?');
    }
    if (preIntent === 'replace') {
      if (preService === 'roofing') { userState[senderId] = { step: 'roof_type', service: 'roofing' }; return sendText(senderId, 'Which roofing material?'); }
      return sendBookingButton(senderId);
    }

    userState[senderId] = { step: 'repair_replace', service: preService, zip: raw };
    return sendText(senderId, `Repair or replace your ${preService}?`);
  }

  // 7) Conversation branches
  switch (state.step) {
    case 'repair_replace': {
      let intent = getBestMatch(raw, ['repair','replace','fix']); if (!intent) intent = ['repair','replace','fix'].find(w=>raw.includes(w)); if (intent==='fix') intent='repair';
      if (!intent) return sendText(senderId, "Type 'repair' or 'replace'.");
      if (intent==='repair') {
        if (state.service==='fence') { userState[senderId] = { step: 'fence_confirm', service: 'fence' }; return sendText(senderId, 'Fence repairs start at $849 – proceed? (Yes/No)'); }
        delete userState[senderId]; return sendText(senderId, `We don't repair ${state.service}.`);
      }
      if (state.service==='roofing') { userState[senderId] = { step: 'roof_type', service: 'roofing' }; return sendText(senderId, 'Which roofing material?'); }
      return sendBookingButton(senderId);
    }
    case 'fence_confirm': {
      const dec = interpretYesNo(raw);
      const aff = AFFIRMATION_PATTERNS.some(rx => rx.test(stripped));
      if (dec==='yes' || aff) return sendBookingButton(senderId);
      if (dec==='no') { delete userState[senderId]; return sendText(senderId, 'No worries!'); }
      return sendText(senderId, 'Proceed with $849 fence repair? (Yes/No)');
    }
    case 'roof_type': {
      const mat = getBestMatch(raw, ['asphalt','metal','cedar shingle']);
      if (mat==='cedar shingle') { userState[senderId] = { step: 'cedar_reject' }; return sendText(senderId, 'We don’t offer cedar; proceed with asphalt or metal? (Yes/No)'); }
      return sendBookingButton(senderId);
    }
    case 'cedar_reject': {
      const dec = interpretYesNo(raw);
      if (dec==='yes') return sendBookingButton(senderId);
      if (dec==='no') { delete userState[senderId]; return sendText(senderId, 'Okay!'); }
      return sendText(senderId, 'Proceed with asphalt/metal? (Yes/No)');
    }
    default:
      delete userState[senderId];
      return sendText(senderId, 'Something went wrong—let’s start over.');
  }
};

// Webhook setup
app.get('/', (req, res) => res.send('Bot running'));
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'], token = req.query['hub.verify_token'], challenge = req.query['hub.challenge'];
  if (mode==='subscribe' && token===VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});
app.post('/webhook', async (req, res) => {
  if (req.body.object !== 'page') return res.sendStatus(404);
  for (const entry of req.body.entry) {
    const msg = entry.messaging[0], sid = msg.sender?.id;
    if (!sid) continue;
    if (msg.message?.quick_reply) continue;
    if (msg.postback?.payload==='GET_STARTED') {
      userState[sid] = { step: 'ask_zip' };
      await sendText(sid, 'Hi! Send your 5-digit ZIP code.');
      continue;
    }
    if (msg.message?.text) await handleMessage(sid, msg.message.text);
  }
  res.sendStatus(200);
});
app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
