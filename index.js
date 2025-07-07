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

const handleMessage = async (senderId, messageText) => {
  const text = messageText.trim().toLowerCase();

  if (['exit', 'cancel', 'stop', 'nevermind'].includes(text)) {
    delete userState[senderId];
    return sendText(senderId, "No problem! If you need anything in the future, just message us again. Take care!");
  }

  const state = userState[senderId] || { step: 'initial' };

  switch (state.step) {
    case 'initial': {
      const match = stringSimilarity.findBestMatch(text, SERVICE_KEYWORDS);
      if (match.bestMatch.rating > 0.3) {
        const service = match.bestMatch.target;
        userState[senderId] = { service, step: 'repair_replace' };
        return sendText(senderId, `Are you looking to repair or replace your ${service}?`);
      }
      return sendText(senderId, "Hi! I'm here to help. What type of service are you looking for? (Fence, Deck, Windows, Doors, Roofing, Gutters)");
    }

    case 'repair_replace': {
      const intent = text.includes('repair') ? 'repair' : text.includes('replace') ? 'replace' : null;
      if (!intent) return sendText(senderId, "Please type either 'repair' or 'replace'.");

      const { service } = state;
      const nextState = { service, intent };

      if (intent === 'repair') {
        if (service === 'windows' || service === 'doors' || service === 'deck' || service === 'roofing' || service === 'gutters') {
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
      if (text.includes('yes')) {
        userState[senderId] = { ...state, step: 'fence_repair_part' };
        return sendText(senderId, "Are you repairing posts or panels?");
      }
      delete userState[senderId];
      return sendText(senderId, "Understood! Let us know if you'd like help with a replacement instead.");
    }

    case 'fence_repair_part':
      userState[senderId] = { ...state, step: 'fence_repair_count' };
      return sendText(senderId, `How many ${text} need work?`);

    case 'fence_repair_count':
    case 'window_quantity':
    case 'door_quantity':
    case 'gutter_feet':
    case 'fence_length':
      userState[senderId] = { ...state, step: 'timeline' };
      return sendText(senderId, "How soon are you looking to get this done?");

    case 'timeline':
      userState[senderId] = { ...state, step: 'schedule' };
      return sendText(senderId, "Awesome. What day works best for a consultation or install?");

    case 'schedule':
      delete userState[senderId];
      return sendText(senderId, "You're all set! We'll follow up shortly to confirm your appointment. Thanks for reaching out! 🙌");

    case 'door_type':
      userState[senderId] = { ...state, step: 'door_quantity' };
      return sendText(senderId, "Great. How many doors are you replacing?");

    case 'deck_type':
      if (text.includes('repair')) {
        delete userState[senderId];
        return sendText(senderId, "Unfortunately we do not offer deck repairs, but we’d love to help with new builds or replacements!");
      }
      userState[senderId] = { ...state, step: 'deck_material' };
      return sendText(senderId, "What material are you thinking of? (Wood or Composite)");

    case 'deck_material':
      userState[senderId] = { ...state, step: 'timeline' };
      return sendText(senderId, "And how soon would you like the project started?");

    case 'fence_type':
      userState[senderId] = { ...state, step: 'fence_length' };
      return sendText(senderId, "Approximately how many linear feet of fencing do you need?");

    case 'roof_type':
      if (text.includes('cedar')) {
        delete userState[senderId];
        return sendText(senderId, "We currently don’t offer cedar shingle installations, but we’d love to help with asphalt or metal options.");
      }
      userState[senderId] = { ...state, step: 'roof_gutters' };
      return sendText(senderId, "Would you like new gutters installed as well? (Yes/No)");

    case 'roof_gutters':
      userState[senderId] = { ...state, step: 'timeline' };
      return sendText(senderId, "Great! How soon are you looking to move forward?");
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
        await handleMessage(event.sender.id, event.message.text || '');
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));



