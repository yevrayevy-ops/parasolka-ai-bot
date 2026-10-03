const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

async function sendTelegramMessage(chatId, text) {
  await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    }
  );
}

async function getCatalog() {
  const response = await fetch(GOOGLE_SCRIPT_URL);

  if (!response.ok) {
    throw new Error("Не удалось получить каталог");
  }

  return await response.json();
}

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      message: "Parasolka AI bot is running"
    });
  }

  try {
    const update = req.body;

    if (!update.message || !update.message.chat) {
      return res.status(200).json({ ok: true });
    }

    const chatId = update.message.chat.id;
    const userText = String(update.message.text || "").trim();

    if (!userText) {
      return res.status(200).json({ ok: true });
    }

    const catalog = await getCatalog();

    const availableProducts = catalog
      .filter(product => product.available)
      .map(product => ({
        name: product.name,
        category: product.category,
        price: product.price,
        description: product.description
      }));

    const systemPrompt = `
Ти — AI-консультант магазину Parasolka Food.

Спілкуйся з клієнтом українською мовою.
Якщо клієнт пише російською — можеш відповідати російською.

Твоє завдання:
- допомагати вибирати товари;
- повідомляти актуальні ціни;
- повідомляти, які товари є в наявності;
- рекомендувати товари відповідно до запиту клієнта;
- не вигадувати товари, ціни або наявність.

Ось актуальний каталог магазину:

${JSON.stringify(availableProducts, null, 2)}

Якщо товару немає в цьому списку, не кажи, що він є в наявності.
Ціни вказуй у форинтах (Ft).
Відповідай коротко, доброзичливо і по суті.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userText
        }
      ]
    });

    const answer =
      completion.choices?.[0]?.message?.content ||
      "Вибачте, зараз не можу відповісти.";

    await sendTelegramMessage(chatId, answer);

    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}

module.exports = handler;
