const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

const IN_STOCK_CATEGORY = "Товари в наявності";

const conversationHistory = new Map();
const MAX_HISTORY_MESSAGES = 8;

function getConversationHistory(chatId) {
  if (!conversationHistory.has(chatId)) {
    conversationHistory.set(chatId, []);
  }

  return conversationHistory.get(chatId);
}

function addToConversationHistory(chatId, role, content) {
  const history = getConversationHistory(chatId);

  history.push({
    role,
    content
  });

  while (history.length > MAX_HISTORY_MESSAGES) {
    history.shift();
  }
}

function detectLanguage(text) {
  if (/[\u0590-\u05FF]/.test(text)) {
    return "HEBREW";
  }

  if (/[ЇїІіЄєҐґ]/.test(text)) {
    return "UKRAINIAN";
  }

  if (/[А-Яа-яЁё]/.test(text)) {
    return "RUSSIAN";
  }

  return "ENGLISH";
}

const LANGUAGE_CODE = {
  UKRAINIAN: "U",
  RUSSIAN: "R",
  ENGLISH: "E",
  HEBREW: "H"
};

const CODE_LANGUAGE = {
  U: "UKRAINIAN",
  R: "RUSSIAN",
  E: "ENGLISH",
  H: "HEBREW"
};

function t(language, key) {
  const texts = {
    UKRAINIAN: {
      confirmChecking: "Перевіряю замовлення...",
      cancelled: "Замовлення скасовано.",
      orderTitle: "Ваше замовлення:",
      stockTitle: "Товари в наявності:",
      preorderTitle: "Попереднє замовлення:",
      together: "Разом:",
      discount: "Знижка 10%:",
      toPay: "До сплати:",
      donation: "20% на користь Парасольки:",
      confirmQuestion: "Підтверджуєте замовлення?",
      contact:
        "Після підтвердження наш співробітник зв'яжеться з вами, щоб остаточно підтвердити замовлення та деталі доставки.",
      payment:
        "⚠️ Оплата здійснюється тільки під час отримання. Parasolka не приймає передоплату. Якщо хтось просить вас оплатити замовлення наперед від імені Parasolka — це шахрайство.",
      confirmButton: "✅ Підтвердити замовлення",
      cancelButton: "❌ Скасувати",
      success: orderNumber =>
        `✅ Дякуємо! Ваше замовлення №${orderNumber} прийнято.`,
      successContact:
        "Наш співробітник зв'яжеться з вами, щоб остаточно підтвердити замовлення та деталі доставки.",
      successPayment:
        "💳 Оплата здійснюється тільки під час отримання.",
      successWarning:
        "⚠️ Parasolka не приймає передоплату. Якщо хтось просить вас оплатити замовлення наперед від імені Parasolka — це шахрайство.",
      stockError: (name, stock) =>
        `${name}: доступно лише ${stock} шт.`,
      unavailable: name =>
        `Товар зараз недоступний: ${name}`,
      notFound: id => `Товар не знайдено: ${id}`,
      invalidQuantity: name =>
        `Невірна кількість: ${name}`,
      genericError:
        "❌ Не вдалося оформити замовлення.\n\nБудь ласка, спробуйте ще раз.",
      tooLarge:
        "Замовлення занадто велике для автоматичного оформлення через чат.\n\nБудь ласка, зробіть замовлення через Mini App Parasolka Food.",
      parseError:
        "Вибачте, зараз не вдалося обробити запит. Спробуйте ще раз."
    },

    RUSSIAN: {
      confirmChecking: "Проверяю заказ...",
      cancelled: "Заказ отменён.",
      orderTitle: "Ваш заказ:",
      stockTitle: "Товары в наличии:",
      preorderTitle: "Предварительный заказ:",
      together: "Итого:",
      discount: "Скидка 10%:",
      toPay: "К оплате:",
      donation: "20% в пользу Парасольки:",
      confirmQuestion: "Подтверждаете заказ?",
      contact:
        "После подтверждения наш сотрудник свяжется с вами, чтобы окончательно подтвердить заказ и детали доставки.",
      payment:
        "⚠️ Оплата производится только при получении. Parasolka не принимает предоплату. Если кто-то просит вас оплатить заказ заранее от имени Parasolka — это мошенничество.",
      confirmButton: "✅ Подтвердить заказ",
      cancelButton: "❌ Отменить",
      success: orderNumber =>
        `✅ Спасибо! Ваш заказ №${orderNumber} принят.`,
      successContact:
        "Наш сотрудник свяжется с вами, чтобы окончательно подтвердить заказ и детали доставки.",
      successPayment:
        "💳 Оплата производится только при получении.",
      successWarning:
        "⚠️ Parasolka не принимает предоплату. Если кто-то просит вас оплатить заказ заранее от имени Parasolka — это мошенничество.",
      stockError: (name, stock) =>
        `${name}: доступно только ${stock} шт.`,
      unavailable: name =>
        `Товар сейчас недоступен: ${name}`,
      notFound: id => `Товар не найден: ${id}`,
      invalidQuantity: name =>
        `Неверное количество: ${name}`,
      genericError:
        "❌ Не удалось оформить заказ.\n\nПожалуйста, попробуйте ещё раз.",
      tooLarge:
        "Заказ слишком большой для автоматического оформления через чат.\n\nПожалуйста, сделайте заказ через Mini App Parasolka Food.",
      parseError:
        "Извините, сейчас не удалось обработать запрос. Попробуйте ещё раз."
    },

    ENGLISH: {
      confirmChecking: "Checking your order...",
      cancelled: "Order cancelled.",
      orderTitle: "Your order:",
      stockTitle: "Items in stock:",
      preorderTitle: "Pre-order:",
      together: "Subtotal:",
      discount: "10% discount:",
      toPay: "Total:",
      donation: "20% for Parasolka:",
      confirmQuestion: "Do you confirm the order?",
      contact:
        "After confirmation, our team member will contact you to confirm the order and delivery details.",
      payment:
        "⚠️ Payment is made only upon receipt. Parasolka does not accept prepayment. If someone asks you to pay in advance on behalf of Parasolka, it is a scam.",
      confirmButton: "✅ Confirm order",
      cancelButton: "❌ Cancel",
      success: orderNumber =>
        `✅ Thank you! Your order №${orderNumber} has been accepted.`,
      successContact:
        "Our team member will contact you to confirm the order and delivery details.",
      successPayment:
        "💳 Payment is made only upon receipt.",
      successWarning:
        "⚠️ Parasolka does not accept prepayment. If someone asks you to pay in advance on behalf of Parasolka, it is a scam.",
      stockError: (name, stock) =>
        `${name}: only ${stock} pcs. available.`,
      unavailable: name =>
        `This product is currently unavailable: ${name}`,
      notFound: id => `Product not found: ${id}`,
      invalidQuantity: name =>
        `Invalid quantity: ${name}`,
      genericError:
        "❌ The order could not be placed.\n\nPlease try again.",
      tooLarge:
        "The order is too large to process automatically in chat.\n\nPlease place the order through the Parasolka Food Mini App.",
      parseError:
        "Sorry, I could not process the request right now. Please try again."
    },

    HEBREW: {
      confirmChecking: "בודק את ההזמנה...",
      cancelled: "ההזמנה בוטלה.",
      orderTitle: "ההזמנה שלך:",
      stockTitle: "מוצרים במלאי:",
      preorderTitle: "הזמנה מראש:",
      together: "סה״כ:",
      discount: "הנחה של 10%:",
      toPay: "לתשלום:",
      donation: "20% לטובת Parasolka:",
      confirmQuestion: "לאשר את ההזמנה?",
      contact:
        "לאחר האישור, איש צוות שלנו יצור איתך קשר כדי לאשר את ההזמנה ופרטי המשלוח.",
      payment:
        "⚠️ התשלום מתבצע רק בעת קבלת ההזמנה. Parasolka אינה מקבלת תשלום מראש. אם מישהו מבקש ממך לשלם מראש בשם Parasolka — מדובר בהונאה.",
      confirmButton: "✅ אישור הזמנה",
      cancelButton: "❌ ביטול",
      success: orderNumber =>
        `✅ תודה! ההזמנה שלך №${orderNumber} התקבלה.`,
      successContact:
        "איש צוות שלנו יצור איתך קשר כדי לאשר את ההזמנה ופרטי המשלוח.",
      successPayment:
        "💳 התשלום מתבצע רק בעת קבלת ההזמנה.",
      successWarning:
        "⚠️ Parasolka אינה מקבלת תשלום מראש. אם מישהו מבקש ממך לשלם מראש בשם Parasolka — מדובר בהונאה.",
      stockError: (name, stock) =>
        `${name}: זמינות של ${stock} יחידות בלבד.`,
      unavailable: name =>
        `המוצר אינו זמין כרגע: ${name}`,
      notFound: id => `המוצר לא נמצא: ${id}`,
      invalidQuantity: name =>
        `כמות לא תקינה: ${name}`,
      genericError:
        "❌ לא ניתן היה לבצע את ההזמנה.\n\nנא לנסות שוב.",
      tooLarge:
        "ההזמנה גדולה מדי לעיבוד אוטומטי בצ'אט.\n\nנא לבצע את ההזמנה דרך Mini App של Parasolka Food.",
      parseError:
        "מצטער, לא הצלחתי לעבד את הבקשה כרגע. נסה שוב."
    }
  };

  return texts[language]?.[key] ?? texts.ENGLISH[key];
}

async function sendTelegramMessage(chatId, text, extra = {}) {
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...extra
      })
    }
  );

  if (!response.ok) {
    console.error(
      "Telegram sendMessage error:",
      await response.text()
    );
  }
}

async function answerCallbackQuery(callbackQueryId, text = "") {
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text
      })
    }
  );

  if (!response.ok) {
    console.error(
      "Telegram answerCallbackQuery error:",
      await response.text()
    );
  }
}

async function editTelegramMessage(
  chatId,
  messageId,
  text,
  extra = {}
) {
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        ...extra
      })
    }
  );

  if (!response.ok) {
    console.error(
      "Telegram editMessageText error:",
      await response.text()
    );
  }
}

async function getCatalog() {
  const response = await fetch(GOOGLE_SCRIPT_URL);

  if (!response.ok) {
    throw new Error("Не удалось получить каталог");
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error("Каталог имеет неверный формат");
  }

  return data;
}

function parseOrderData(data) {
  const result = [];

  if (!data) {
    return result;
  }

  data.split(",").forEach(part => {
    const pieces = part.split("=");

    if (pieces.length !== 2) {
      return;
    }

    const id = String(pieces[0]).trim();
    const quantity = Number(pieces[1]);

    if (id && quantity > 0) {
      result.push({
        id,
        quantity
      });
    }
  });

  return result;
}

function createOrderData(items) {
  return items
    .map(item => `${item.id}=${item.quantity}`)
    .join(",");
}

function createCallbackData(action, language, orderData = "") {
  const code = LANGUAGE_CODE[language] || "E";

  if (action === "cancel") {
    return `cancel:${code}`;
  }

  return `confirm:${code}:${orderData}`;
}

function parseCallbackData(data) {
  if (data === "cancel") {
    return {
      action: "cancel",
      language: "UKRAINIAN"
    };
  }

  if (data.startsWith("cancel:")) {
    const code = data.split(":")[1] || "E";

    return {
      action: "cancel",
      language: CODE_LANGUAGE[code] || "ENGLISH"
    };
  }

  if (data.startsWith("confirm:")) {
    const parts = data.split(":");
    const code = parts[1] || "E";
    const orderData = parts.slice(2).join(":");

    return {
      action: "confirm",
      language: CODE_LANGUAGE[code] || "ENGLISH",
      orderData
    };
  }

  return null;
}

function canFitCallbackData(callbackData) {
  return Buffer.byteLength(callbackData, "utf8") <= 64;
}

function calculateOrder(items, catalog, language = "ENGLISH") {
  let inStockSubtotal = 0;
  let preorderSubtotal = 0;

  const detailedItems = [];

  for (const item of items) {
    const product = catalog.find(
      p => String(p.id) === String(item.id)
    );

    if (!product) {
      throw new Error(t(language, "notFound")(item.id));
    }

    if (!product.available) {
      throw new Error(t(language, "unavailable")(product.name));
    }

    const quantity = Number(item.quantity);

    if (!Number.isFinite(quantity) || quantity < 1) {
      throw new Error(t(language, "invalidQuantity")(product.name));
    }

    if (product.category === IN_STOCK_CATEGORY) {
      const stock = Number(product.stockQuantity || 0);

      if (quantity > stock) {
        throw new Error(
          t(language, "stockError")(product.name, stock)
        );
      }

      inStockSubtotal +=
        Number(product.price || 0) * quantity;
    } else {
      preorderSubtotal +=
        Number(product.price || 0) * quantity;
    }

    detailedItems.push({
      id: product.id,
      name: product.name,
      category: product.category,
      price: Number(product.price || 0),
      quantity
    });
  }

  const onlineDiscount = preorderSubtotal * 0.10;

  const total =
    inStockSubtotal +
    preorderSubtotal -
    onlineDiscount;

  const parasolkaAmount = total * 0.20;

  return {
    detailedItems,
    inStockSubtotal,
    preorderSubtotal,
    onlineDiscount,
    total,
    parasolkaAmount
  };
}

function formatMoney(value) {
  return (
    Number(value || 0).toLocaleString("uk-UA") +
    " Ft"
  );
}

function formatOrderPreview(calculation, language) {
  let text = `${t(language, "orderTitle")}\n\n`;

  const stockItems =
    calculation.detailedItems.filter(
      item => item.category === IN_STOCK_CATEGORY
    );

  const preorderItems =
    calculation.detailedItems.filter(
      item => item.category !== IN_STOCK_CATEGORY
    );

  if (stockItems.length) {
    text += `${t(language, "stockTitle")}\n`;

    stockItems.forEach(item => {
      text +=
        `• ${item.name} × ${item.quantity} — ` +
        `${formatMoney(item.price * item.quantity)}\n`;
    });

    text +=
      `${t(language, "together")} ` +
      `${formatMoney(calculation.inStockSubtotal)}\n\n`;
  }

  if (preorderItems.length) {
    text += `${t(language, "preorderTitle")}\n`;

    preorderItems.forEach(item => {
      text +=
        `• ${item.name} × ${item.quantity} — ` +
        `${formatMoney(item.price * item.quantity)}\n`;
    });

    text +=
      `${t(language, "together")} ` +
      `${formatMoney(calculation.preorderSubtotal)}\n`;

    text +=
      `${t(language, "discount")} −` +
      `${formatMoney(calculation.onlineDiscount)}\n\n`;
  }

  text +=
    `${t(language, "toPay")} ` +
    `${formatMoney(calculation.total)}\n`;

  text +=
    `${t(language, "donation")} ` +
    `${formatMoney(calculation.parasolkaAmount)}\n\n`;

  text += `${t(language, "confirmQuestion")}\n\n`;
  text += `${t(language, "contact")}\n\n`;
  text += t(language, "payment");

  return text;
}

async function createGoogleOrder(order) {
  const response = await fetch(
    GOOGLE_SCRIPT_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(order)
    }
  );

  if (!response.ok) {
    throw new Error("Не удалось отправить заказ");
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(
      result.error ||
      "Google Apps Script не принял заказ"
    );
  }

  return result;
}

async function handleConfirmation(callbackQuery) {
  const callbackId = callbackQuery.id;
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const callbackData = callbackQuery.data || "";

  const parsed = parseCallbackData(callbackData);

  const language =
    parsed?.language || "ENGLISH";

  await answerCallbackQuery(
    callbackId,
    t(language, "confirmChecking")
  );

  try {
    if (!parsed) {
      return;
    }

    if (parsed.action === "cancel") {
      await editTelegramMessage(
        chatId,
        messageId,
        t(language, "cancelled")
      );

      return;
    }

    const requestedItems =
      parseOrderData(parsed.orderData);

    if (!requestedItems.length) {
      throw new Error(
        "Не удалось определить товары."
      );
    }

    const catalog = await getCatalog();

    const calculation =
      calculateOrder(
        requestedItems,
        catalog,
        language
      );

    const telegramUser =
      callbackQuery.from || {};

    const orderItems =
      calculation.detailedItems.map(item => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.price
      }));

    const order = {
      name:
        telegramUser.first_name ||
        telegramUser.username ||
        "",

      phone: "",

      telegramUser: {
        id: telegramUser.id,
        username:
          telegramUser.username || "",
        first_name:
          telegramUser.first_name || "",
        last_name:
          telegramUser.last_name || ""
      },

      comment:
        "Замовлення з AI Telegram бота",

      items: orderItems
    };

    const result =
      await createGoogleOrder(order);

    let confirmationText =
      `${t(language, "success")(result.orderNumber)}\n\n`;

    confirmationText +=
      `${t(language, "successContact")}\n\n`;

    confirmationText +=
      `${t(language, "successPayment")}\n\n`;

    confirmationText +=
      t(language, "successWarning");

    await editTelegramMessage(
      chatId,
      messageId,
      confirmationText,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🛍 Мої замовлення",
                url:
                  "https://t.me/Parasolkafoodbot?startapp"
              }
            ]
          ]
        }
      }
    );
  } catch (error) {
    console.error(
      "CONFIRMATION ERROR:",
      error
    );

    await editTelegramMessage(
      chatId,
      messageId,
      `${t(language, "genericError")}\n\n${error.message}`
    );
  }
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

    if (update.callback_query) {
      await handleConfirmation(
        update.callback_query
      );

      return res.status(200).json({
        ok: true
      });
    }

    if (
      !update.message ||
      !update.message.chat
    ) {
      return res.status(200).json({
        ok: true
      });
    }

    const chatId =
      update.message.chat.id;

    const userText =
      String(
        update.message.text || ""
      ).trim();

    if (!userText) {
      return res.status(200).json({
        ok: true
      });
    }

    /*
     * ВАЖНО:
     * Сначала добавляем именно текущее сообщение пользователя
     * в историю. В старом коде этого не было — AI видел историю,
     * но НЕ видел текущий вопрос пользователя.
     */
    addToConversationHistory(
      chatId,
      "user",
      userText
    );

    const catalog =
      await getCatalog();

    const catalogForAI =
      catalog
        .filter(product => product.available)
        .map(product => ({
          id: product.id,
          name: product.name,
          category: product.category,
          price: product.price,
          stockQuantity:
            product.stockQuantity,
          description:
            product.description
        }));

    const clientLanguage =
      detectLanguage(userText);

    const systemPrompt = `
Ты — AI-консультант магазина Parasolka Food.

ТЕКУЩИЙ ЯЗЫК КЛИЕНТА:
${clientLanguage}

Отвечай клиенту только на этом языке.
Если клиент сменил язык — используй новый язык.
Не объясняй выбор языка.

ГЛАВНОЕ ПРАВИЛО:
ТЕКУЩЕЕ сообщение клиента важнее предыдущей темы разговора.
Сначала отвечай на текущий вопрос.
Не продолжай предыдущую тему, если клиент явно спрашивает о другом товаре или категории.

Например:
если раньше обсуждали мёд, а сейчас клиент пишет "что есть из рыбы?",
нужно искать рыбу в каталоге и НЕ отвечать про мёд.

Для вопросов:
- "что есть из рыбы?"
- "какая есть рыба?"
- "what fish do you have?"
- "what do you have in fish?"
- "какая рыба есть?"
ищи соответствующие товары по названию, категории и описанию.

Если клиент просто спрашивает об ассортименте, цене или наличии — НЕ создавай заказ.
Если клиент хочет заказать товар, для заказа нужны товар и количество.
Если количество не указано — спроси количество.

Если клиент пишет "да", "беру", "хочу", "заказывай", "yes" и т.п.,
можно использовать предыдущий контекст ТОЛЬКО если из него однозначно понятно,
какой товар и какое количество имеются в виду.

Если клиент спрашивает о другом товаре, предыдущий товар больше не является главным контекстом.

Не показывай клиенту ID товаров, внутренние номера, stockQuantity,
JSON или другие технические данные.
ID используй только во внутреннем JSON заказа.

ТОВАРЫ:
- Категория "Товари в наявності": товар есть сейчас; скидка 10% не применяется;
  количество ограничено stockQuantity.
- Все остальные категории: это предварительный заказ; действует онлайн-скидка 10%.
- Один и тот же товар может иметь одновременно строку "Товари в наявності"
  и строку предварительного заказа. Это два разных варианта покупки.
- Не говори, что товар можно получить сейчас, если он не относится к категории
  "Товари в наявності".
- Не придумывай товары, цены или наличие.
- Все цены в каталоге указаны в форинтах. Используй Ft, не грн и не UAH.
- Оплата только при получении. Передоплаты нет.

ФОРМАТ ОТВЕТА:
Возвращай только JSON.

Обычный ответ:
{
  "type": "answer",
  "message": "текст для клиента",
  "items": []
}

Заказ:
{
  "type": "order",
  "message": "текст для клиента",
  "items": [
    {
      "id": "ID товара",
      "quantity": 2
    }
  ]
}

items заполняй только когда клиент действительно хочет сделать заказ
и товар с количеством достаточно определены.

Не показывай ID в message.

АКТУАЛЬНЫЙ КАТАЛОГ:
${JSON.stringify(catalogForAI, null, 2)}
`;

    const history =
      getConversationHistory(chatId);

    const completion =
      await openai.chat.completions.create({
        model: "gpt-5-mini",

        response_format: {
          type: "json_object"
        },

        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          ...history
        ]
      });

    const rawAnswer =
      completion
        .choices?.[0]
        ?.message
        ?.content || "{}";

    let aiResult;

    try {
      aiResult =
        JSON.parse(rawAnswer);
    } catch (parseError) {
      await sendTelegramMessage(
        chatId,
        t(clientLanguage, "parseError")
      );

      return res.status(200).json({
        ok: true
      });
    }

    addToConversationHistory(
      chatId,
      "assistant",
      rawAnswer
    );

    if (
      aiResult.type !== "order" ||
      !Array.isArray(aiResult.items) ||
      !aiResult.items.length
    ) {
      await sendTelegramMessage(
        chatId,
        aiResult.message ||
          t(clientLanguage, "parseError")
      );

      return res.status(200).json({
        ok: true
      });
    }

    const requestedItems =
      aiResult.items.map(item => ({
        id:
          String(item.id).trim(),

        quantity:
          Number(item.quantity)
      }));

    const calculation =
      calculateOrder(
        requestedItems,
        catalog,
        clientLanguage
      );

    const orderData =
      createOrderData(requestedItems);

    const confirmCallback =
      createCallbackData(
        "confirm",
        clientLanguage,
        orderData
      );

    const cancelCallback =
      createCallbackData(
        "cancel",
        clientLanguage
      );

    if (
      !canFitCallbackData(confirmCallback) ||
      !canFitCallbackData(cancelCallback)
    ) {
      await sendTelegramMessage(
        chatId,
        t(clientLanguage, "tooLarge")
      );

      return res.status(200).json({
        ok: true
      });
    }

    const preview =
      formatOrderPreview(
        calculation,
        clientLanguage
      );

    await sendTelegramMessage(
      chatId,
      preview,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  t(
                    clientLanguage,
                    "confirmButton"
                  ),
                callback_data:
                  confirmCallback
              }
            ],
            [
              {
                text:
                  t(
                    clientLanguage,
                    "cancelButton"
                  ),
                callback_data:
                  cancelCallback
              }
            ]
          ]
        }
      }
    );

    return res.status(200).json({
      ok: true
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}

module.exports = handler;
