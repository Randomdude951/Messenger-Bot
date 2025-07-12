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

const userState = {};

const validZipCodes = new Set([
  "98011", "98012", "98020", "98021", "98026", "98028", "98033", "98034", "98036",
  "98037", "98043", "98072", "98087", "98133", "98155", "98201", "98203", "98204",
  "98208", "98223", "98229", "98232", "98233", "98235", "98238", "98241", "98244",
  "98247", "98248", "98249", "98250", "98252", "98255", "98257", "98258", "98260",
  "98263", "98266", "98267", "98270", "98271", "98272", "98273", "98274", "98275",
  "98276", "98277", "98278", "98279", "98280", "98282", "98283", "98284", "98286",
  "98287", "98288", "98290", "98291", "98292", "98293", "98294", "98295", "98296",
  "98297"
]);

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

const sendBookingButton = async (senderId) => {
  await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: senderId },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: "You're a great fit! Go ahead and book your consultation here:",
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
  });
  delete userState[senderId];
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

const handleMessage = async (senderId, messageText) => {
  const text = messageText.trim().toLowerCase();

  if (["exit", "cancel", "stop", "nevermind"].includes(text)) {
    delete userState[senderId];
    return sendText(senderId, "No problem! If you need anything in the future, just message us again. Take care!");
  }

  let state = userState[senderId] || { step: "ask_zip" };

  // ZIP validation must come first
  if (state.step === "ask_zip") {
    if (!/^\d{5}$/.test(text)) {
      return sendText(senderId, "Hi! I’m here to help. Could you please send your 5-digit ZIP code so I can check if we serve your area?");
    }

    if (!validZipCodes.has(text)) {
      delete userState[senderId];
      return sendText(senderId, "Unfortunately, we’re not servicing that area at this time. Please check back later!");
    }

    userState[senderId] = { ...state, zip: text, step: "initial", greeted: false };
    return sendText(senderId, "Great! What type of service are you looking for? (Fence, Deck, Windows, Doors, Roofing, Gutters)");
  }

  // Proceed through normal flow
  switch (state.step) {
    case "initial": {
      const service = getBestMatch(text, SERVICE_KEYWORDS);
      if (service) {
        userState[senderId] = { ...state, service, step: "repair_replace", greeted: true };
        return sendText(senderId, `Are you looking to repair or replace your ${service}?`);
      }
      return sendText(senderId, "What type of service are you looking for? (Fence, Deck, Windows, Doors, Roofing, Gutters)");
    }

    case "repair_replace": {
      const intent = getBestMatch(text, ["repair", "replace"]);
      if (!intent) return sendText(senderId, "Please type either 'repair' or 'replace'.");

      const { service } = state;
      const nextState = { ...state, intent };

      if (intent === "repair") {
        if (["windows", "doors", "deck", "roofing", "gutters"].includes(service)) {
          delete userState[senderId];
          return sendText(senderId, `Unfortunately, we do not offer ${service} repairs at this time.`);
        }

        if (service === "fence") {
          userState[senderId] = { ...nextState, step: "fence_repair_confirm" };
          return sendText(senderId, "Fence repairs start at a $849 minimum. Would you like to proceed? (Yes/No)");
        }
      } else if (intent === "replace") {
        switch (service) {
          case "windows":
          case "doors":
          case "deck":
          case "fence":
          case "gutters":
            return sendBookingButton(senderId);
          case "roofing":
            userState[senderId] = { ...nextState, step: "roof_type" };
            return sendText(senderId, "What type of roofing material are you looking for? (Asphalt, Metal, Cedar Shingles)");
        }
      }
      break;
    }

    case "fence_repair_confirm": {
      const decision = interpretYesNo(text);
      if (decision === "yes") {
        return sendBookingButton(senderId);
      } else if (decision === "no") {
        delete userState[senderId];
        return sendText(senderId, "No worries! Let us know if you change your mind.");
      } else {
        return sendText(senderId, "Just to confirm, would you like to proceed with the $849 minimum fence repair? (Yes/No)");
      }
    }

    case "roof_type": {
      const roofType = getBestMatch(text, ["asphalt", "metal", "cedar shingle"]);
      if (roofType === "cedar shingle") {
        delete userState[senderId];
        return sendText(senderId, "We currently don’t offer cedar shingle installations, but we’d love to help with asphalt or metal options.");
      }
      return sendBookingButton(senderId);
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
      const senderId = event.sender && event.sender.id;

      if (!senderId) continue;

      if (event.postback?.payload === "GET_STARTED") {
        userState[senderId] = { step: "ask_zip" };
        await sendText(senderId, "Hi! Before we begin, could you tell me your ZIP code so I can check if you're in our service area?");
        return;
      }

      if (event.message?.text) {
        await handleMessage(senderId, event.message.text);
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
