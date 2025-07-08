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

const YES_NO_KEYWORDS = [
  'yes', 'no',
  'yeah', 'ye', 'yup', 'ok', 'okay', 'sure', 'affirmative',
  'nah', 'nope', 'negative'
];

const userState = {};

const sendText = async (senderId, text) => {
  await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: senderId },
      message: { text: text }
    })
  });
};

const getUserName = async (senderId) => {
  try {
    const res = await fetch(`https://graph.facebook.com/${senderId}?fields=first_name,last_name&access_token=${PAGE_ACCESS_TOKEN}`);
    const data = await res.json();
    if (data.first_name && data.last_name) {
      return `${data.first_name} ${data.last_name}`;
    } else {
      return senderId;
    }
  } catch (err) {
    console.error('Failed to fetch user name:', err);
    return senderId;
  }
};

const logLead = async (dataArray) => {
  await fetch('https://script.google.com/macros/s/AKfycbya3rdULqjJa1GEUudYBhKyai57xNZy6CG8df6US7-T4ghupvAZ_jJSsGF6L4dXb9YJpA/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({values: dataArray })
  }).catch(console.error);
};

const getBestMatch = (input, options) => {
  const match = stringSimilarity.findBestMatch(input.trim().toLowerCase(), options);
  return match.bestMatch.rating > 0.4 ? match.bestMatch.target : null;
};

const interpretYesNo = (input) => {
  const response = getBestMatch(input, YES_NO_KEYWORDS);
  if (!response) return null;
  return ['yes', 'yeah', 'ye', 'yup', 'ok', 'okay', 'sure', 'affirmative'].includes(response)
    ? 'yes'
    : ['no', 'nah', 'nope', 'negative'].includes(response)
      ? 'no'
      : null;
};

const getFencePart = (input) => {
  return getBestMatch(input, ['posts', 'panels']) || input;
};

const handleMessage = async (senderId, messageText) => {
  const text = messageText.trim().toLowerCase();

  if (['exit', 'cancel', 'stop', 'nevermind'].includes(text)) {
    delete userState[senderId];
    return sendText(senderId, "No problem! If you need anything in the future, just message us again. Take care!");
  }

  const state = userState[senderId] || { step: 'initial' };

  switch (state.step) {
    case 'initial': {
      const service = getBestMatch(text, SERVICE_KEYWORDS);
      if (service) {
        userState[senderId] = { service, step: 'repair_replace' };
        return sendText(senderId, `Are you looking to repair or replace your ${service}? Also, could you please provide your ZIP code?`);
      }
      return sendText(senderId, "Hi! I'm here to help. What type of service are you looking for? (Fence, Deck, Windows, Doors, Roofing, Gutters)");
    }

    case 'repair_replace': {
      const intent = getBestMatch(text, ['repair', 'replace']);
      if (!intent) return sendText(senderId, "Please type either 'repair' or 'replace'.");

      const { service } = state;
      const nextState = { service, intent };

      if (intent === 'repair') {
        if (['windows', 'doors', 'deck', 'roofing', 'gutters'].includes(service)) {
          delete userState[senderId];
          return sendText(senderId, `Unfortunately, we do not offer ${service} repairs at this time.`);
        }
        if (service === 'fence') {
          userState[senderId] = { ...nextState, step: 'fence_repair_quote' };
          return sendText(senderId, "Fence repairs start at a $849 minimum. Would you like to proceed? (Yes/No)");
        }
      } else if (intent === 'replace') {
        switch (service) {
          case 'windows':
            userState[senderId] = { ...nextState, step: 'window_quantity' };
            return sendText(senderId, "How many windows would you like replaced?");
          case 'doors':
            userState[senderId] = { ...nextState, step: 'door_type' };
            return sendText(senderId, "Are they interior or exterior doors?");
          case 'deck':
            userState[senderId] = { ...nextState, step: 'deck_type' };
            return sendText(senderId, "Is this a replacement, new construction, or resurface project?");
          case 'fence':
            userState[senderId] = { ...nextState, step: 'fence_type' };
            return sendText(senderId, "What type of fence are you interested in? (Wood, Chain-link, Vinyl, Decorative Metal)");
          case 'roofing':
            userState[senderId] = { ...nextState, step: 'roof_type' };
            return sendText(senderId, "What type of roofing material are you looking for? (Asphalt, Metal, Cedar Shingles)");
          case 'gutters':
            userState[senderId] = { ...nextState, step: 'gutter_feet' };
            return sendText(senderId, "Roughly how many feet of gutters do you need replaced?");
        }
      }
      break;
    }

    case 'fence_repair_quote': {
      const decision = interpretYesNo(text);
      if (decision === 'yes') {
        userState[senderId] = { ...state, step: 'fence_repair_part' };
        return sendText(senderId, "Are you repairing posts or panels?");
      } else if (decision === 'no') {
        delete userState[senderId];
        return sendText(senderId, "Understood! Let us know if you'd like help with a replacement instead.");
      } else {
        return sendText(senderId, "Would you like to proceed with a $849 minimum repair? (Yes/No)");
      }
    }

    case 'fence_repair_part': {
      const part = getFencePart(text);
      userState[senderId] = { ...state, step: 'fence_repair_count', detail: part };
      return sendText(senderId, `How many ${part} need work?`);
    }

    case 'fence_repair_count':
    case 'window_quantity':
    case 'door_quantity':
    case 'gutter_feet':
    case 'fence_length':
      userState[senderId] = { ...state, step: 'timeline', detail: text };
      return sendText(senderId, "How soon are you looking to get this done?");

    case 'timeline':
      userState[senderId] = { ...state, step: 'schedule', timeline: text };
      return sendText(senderId, "Awesome. What day works best for a consultation or install?");

    case 'schedule': {
      const name = await getUserName(senderId);
      const fullState = userState[senderId] || {};
      await logLead([
        name,
        fullState.service,
        fullState.intent,
        fullState.detail || '',
        fullState.timeline || '',
        text, // schedule
        fullState.zip || ''
      ]);
      delete userState[senderId];
      return sendText(senderId, "You're all set! We'll follow up shortly to confirm your appointment. Thanks for reaching out! 🙌");
    }

    case 'door_type':
      userState[senderId] = { ...state, step: 'door_quantity' };
      return sendText(senderId, "Great. How many doors are you replacing?");

    case 'deck_type': {
      const type = getBestMatch(text, ['replace', 'new construction', 'resurface', 'repair']);
      if (type === 'repair') {
        delete userState[senderId];
        return sendText(senderId, "Unfortunately we do not offer deck repairs, but we’d love to help with new builds or replacements!");
      }
      userState[senderId] = { ...state, step: 'deck_material' };
      return sendText(senderId, "What material are you thinking of? (Wood or Composite)");
    }

    case 'deck_material':
      userState[senderId] = { ...state, step: 'timeline', detail: text };
      return sendText(senderId, "And how soon would you like the project started?");

    case 'fence_type':
      userState[senderId] = { ...state, step: 'fence_length', detail: text };
      return sendText(senderId, "Approximately how many linear feet of fencing do you need?");

    case 'roof_type': {
      const roofType = getBestMatch(text, ['asphalt', 'metal', 'cedar shingle']);
      if (roofType === 'cedar shingle') {
        delete userState[senderId];
        return sendText(senderId, "We currently don’t offer cedar shingle installations, but we’d love to help with asphalt or metal options.");
      }
      userState[senderId] = { ...state, step: 'roof_gutters', detail: roofType };
      return sendText(senderId, "Would you like new gutters installed as well? (Yes/No)");
    }

    case 'roof_gutters': {
      const decision = interpretYesNo(text);
      userState[senderId] = { ...state, step: 'timeline' };
      return sendText(senderId, "Great! How soon are you looking to move forward?");
    }
  }
};

app.get('/', (req, res) => res.send('Messenger bot is running'));

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  if (req.body.object === 'page') {
    for (const entry of req.body.entry) {
      const event = entry.messaging[0];
      if (event.message && event.sender && event.sender.id) {
        const text = event.message.text || '';
        const senderId = event.sender.id;

        // Check if this looks like a zip code (simple check for 5 digits)
        if (/^\d{5}$/.test(text)) {
          userState[senderId] = { ...(userState[senderId] || {}), zip: text };
          await sendText(senderId, "Thanks! Now back to your request — what type of service do you need help with? (Fence, Deck, Windows, Doors, Roofing, Gutters)");
        } else {
          await handleMessage(senderId, text);
        }
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
