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

  const state = userState[senderId] || { step: "initial", greeted: false };

  if (!state.greeted) {
    userState[senderId] = { ...state, greeted: true };
    return sendText(senderId, "Hi! I'm here to help. What type of service are you looking for? (Fence, Deck, Windows, Doors, Roofing, Gutters)");
  }

  switch (state.step) {
    case "initial": {
      const service = getBestMatch(text, SERVICE_KEYWORDS);
      if (service) {
        userState[senderId] = { service, step: "repair_replace", greeted: true };
        return sendText(
          senderId,
          `Are you looking to repair or replace your ${service}? Also, could you please provide your ZIP code?`
        );
      }
      return sendText(
        senderId,
        "Hi! I'm here to help. What type of service are you looking for? (Fence, Deck, Windows, Doors, Roofing, Gutters)"
      );
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

    case "repair_replace": {
      const intent = getBestMatch(text, ["repair", "replace"]);
      if (!intent) return sendText(senderId, "Please type either 'repair' or 'replace'.");

      const { service } = state;
      const nextState = { service, intent };

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
            return sendText(
              senderId,
              "What type of roofing material are you looking for? (Asphalt, Metal, Cedar Shingles)"
            );
        }
      }
      break;
    }

    case "roof_type": {
      const roofType = getBestMatch(text, ["asphalt", "metal", "cedar shingle"]);
      if (roofType === "cedar shingle") {
        delete userState[senderId];
        return sendText(
          senderId,
          "We currently don’t offer cedar shingle installations, but we’d love to help with asphalt or metal options."
        );
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

      if (event.postback?.referral?.ref === "welcome_ad" || event.referral?.ref === "welcome_ad") {
        const senderId = event.sender.id;
        userState[senderId] = { step: "initial", greeted: false };
        await sendText(senderId, "Hi! I'm here to help. What type of service are you looking for? (Fence, Deck, Windows, Doors, Roofing, Gutters)");
        return;
      }

      if (event.message && event.sender && event.sender.id) {
        const text = event.message.text || '';
        const senderId = event.sender.id;

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
