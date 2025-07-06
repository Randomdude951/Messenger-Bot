const fetch = require('node-fetch');
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging[0];
      const senderId = webhookEvent.sender.id;

      if (webhookEvent.message && webhookEvent.message.text) {
        const responseText = {
          recipient: { id: senderId },
          message: { text: 'Hi there! This is a test auto-reply.' }
        };

        try {
          const fbRes = await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(responseText)
          });

          const fbData = await fbRes.json();
          console.log('✅ Sent message:', fbData);
        } catch (error) {
          console.error('❌ Failed to send message:', error);
        }
      }
    }

    res.sendStatus(200); // Acknowledge receipt of the event
  } else {
    res.sendStatus(404); // Not a page subscription
  }
});








