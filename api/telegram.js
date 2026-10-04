const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

const IN_STOCK_CATEGORY = "Товари в наявності";
/*
 * Коротка пам'ять діалогу для кожного Telegram користувача.
 *
 * Зберігаємо останні повідомлення, щоб AI розумів
 * фрази на кшталт:
 * "Так, хочу замовити"
 * після попередньої пропозиції товару.
 */
const conversationHistory = new Map();

const MAX_HISTORY_MESSAGES = 10;

function getConversationHistory(chatId) {
  if (!conversationHistory.has(chatId)) {
    conversationHistory.set(chatId, []);
  }

  return conversationHistory.get(chatId);
}

function addToConversationHistory(
  chatId,
  role,
  content
) {
  const history =
    getConversationHistory(chatId);

  history.push({
    role,
    content
  });

  while (
    history.length >
    MAX_HISTORY_MESSAGES
  ) {
    history.shift();
  }
}
async function sendTelegramMessage(chatId, text, extra = {}) {
  await fetch(
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
}

async function answerCallbackQuery(callbackQueryId, text = "") {
  await fetch(
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
}

async function editTelegramMessage(chatId, messageId, text) {
  await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
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


/*
 * Разбираем короткую строку заказа:
 *
 * 1=2,154=1
 *
 * означает:
 * товар ID 1 — 2 шт.
 * товар ID 154 — 1 шт.
 */
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


/*
 * Формируем короткую строку для callback_data.
 *
 * Например:
 * 1=2,154=1
 */
function createOrderData(items) {
  return items
    .map(item => `${item.id}=${item.quantity}`)
    .join(",");
}


/*
 * Telegram callback_data ограничен 64 байтами.
 */
function canFitCallbackData(orderData) {
  return Buffer.byteLength(
    `confirm:${orderData}`,
    "utf8"
  ) <= 64;
}


/*
 * Расчёт заказа на стороне бота нужен только
 * для показа клиенту предварительного итога.
 *
 * Окончательный расчёт всё равно делает
 * Google Apps Script при сохранении заказа.
 */
function calculateOrder(items, catalog) {
  let inStockSubtotal = 0;
  let preorderSubtotal = 0;

  const detailedItems = [];

  for (const item of items) {
    const product = catalog.find(
      p => String(p.id) === String(item.id)
    );

    if (!product) {
      throw new Error(
        `Товар не найден: ${item.id}`
      );
    }

    if (!product.available) {
      throw new Error(
        `Товар сейчас недоступен: ${product.name}`
      );
    }

    const quantity = Number(item.quantity);

    if (!quantity || quantity < 1) {
      throw new Error(
        `Неверное количество: ${product.name}`
      );
    }

    /*
     * Для товара из наличия проверяем
     * текущий остаток ещё до подтверждения.
     */
    if (
      product.category === IN_STOCK_CATEGORY
    ) {
      const stock =
        Number(product.stockQuantity || 0);

      if (quantity > stock) {
        throw new Error(
          `${product.name}: доступно только ${stock} шт.`
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

  const onlineDiscount =
    preorderSubtotal * 0.10;

  const total =
    inStockSubtotal +
    preorderSubtotal -
    onlineDiscount;

  const parasolkaAmount =
    total * 0.20;

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
  return Number(value || 0)
    .toLocaleString("uk-UA") + " Ft";
}


function formatOrderPreview(calculation) {
  let text = "Ваше замовлення:\n\n";

  const stockItems =
    calculation.detailedItems.filter(
      item =>
        item.category === IN_STOCK_CATEGORY
    );

  const preorderItems =
    calculation.detailedItems.filter(
      item =>
        item.category !== IN_STOCK_CATEGORY
    );

  if (stockItems.length) {
    text += "Товари в наявності:\n";

    stockItems.forEach(item => {
      text +=
        `• ${item.name} × ${item.quantity} — ` +
        `${formatMoney(item.price * item.quantity)}\n`;
    });

    text +=
      `Разом: ${formatMoney(calculation.inStockSubtotal)}\n\n`;
  }

  if (preorderItems.length) {
    text += "Попереднє замовлення:\n";

    preorderItems.forEach(item => {
      text +=
        `• ${item.name} × ${item.quantity} — ` +
        `${formatMoney(item.price * item.quantity)}\n`;
    });

    text +=
      `Разом: ${formatMoney(calculation.preorderSubtotal)}\n`;

    text +=
      `Знижка 10%: −${formatMoney(calculation.onlineDiscount)}\n\n`;
  }

  text +=
    `До сплати: ${formatMoney(calculation.total)}\n`;

  text +=
    `20% на користь Парасольки: ${formatMoney(calculation.parasolkaAmount)}\n\n`;

  text +=
    "Підтверджуєте замовлення?\n\n";

  text +=
    "Після підтвердження наш співробітник зв'яжеться " +
    "з вами, щоб остаточно підтвердити замовлення та деталі доставки.\n\n";

  text +=
    "⚠️ Оплата здійснюється тільки під час отримання.\n" +
    "Parasolka не приймає передоплату. " +
    "Якщо хтось просить вас оплатити замовлення наперед " +
    "від імені Parasolka — це шахрайство.";

  return text;
}


/*
 * Отправляем заказ в существующий Google Apps Script.
 *
 * ВАЖНО:
 * Мы используем тот же формат, который уже
 * используется Mini App.
 */
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
    throw new Error(
      "Не удалось отправить заказ"
    );
  }

  const result =
    await response.json();

  if (!result.success) {
    throw new Error(
      result.error ||
      "Google Apps Script не принял заказ"
    );
  }

  return result;
}


async function handleConfirmation(
  callbackQuery
) {
  const callbackId =
    callbackQuery.id;

  const chatId =
    callbackQuery.message.chat.id;

  const messageId =
    callbackQuery.message.message_id;

  const callbackData =
    callbackQuery.data || "";

  await answerCallbackQuery(
    callbackId,
    "Перевіряю замовлення..."
  );

  try {
    if (
      callbackData ===
      "cancel"
    ) {
      await editTelegramMessage(
        chatId,
        messageId,
        "Замовлення скасовано."
      );

      return;
    }

    if (
      !callbackData.startsWith(
        "confirm:"
      )
    ) {
      return;
    }

    const orderData =
      callbackData.substring(
        "confirm:".length
      );

    const requestedItems =
      parseOrderData(orderData);

    if (!requestedItems.length) {
      throw new Error(
        "Не вдалося визначити товари."
      );
    }

    /*
     * ОБЯЗАТЕЛЬНО заново получаем каталог.
     *
     * Это защищает от ситуации, когда
     * остаток изменился после показа
     * пользователю предварительного итога.
     */
    const catalog =
      await getCatalog();

    const calculation =
      calculateOrder(
        requestedItems,
        catalog
      );

    const telegramUser =
      callbackQuery.from || {};

    const orderItems =
      calculation.detailedItems.map(
        item => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          price: item.price
        })
      );

    const order = {
      name:
        telegramUser.first_name ||
        telegramUser.username ||
        "",

      phone: "",

      telegramUser: {
        id: telegramUser.id,
        username:
          telegramUser.username ||
          "",
        first_name:
          telegramUser.first_name ||
          "",
        last_name:
          telegramUser.last_name ||
          ""
      },

      comment:
        "Замовлення з AI Telegram бота",

      items: orderItems
    };

    /*
     * Google Apps Script ещё раз проверит
     * остаток и только потом спишет его.
     */
    const result =
      await createGoogleOrder(order);

    let confirmationText =
      "✅ Дякуємо! Ваше замовлення №" +
      result.orderNumber +
      " прийнято.\n\n";

    confirmationText +=
      "Наш співробітник зв'яжеться з вами, " +
      "щоб остаточно підтвердити замовлення " +
      "та деталі доставки.\n\n";

    confirmationText +=
      "💳 Оплата здійснюється тільки під час отримання.\n\n";

    confirmationText +=
      "⚠️ Parasolka не приймає передоплату. " +
      "Якщо хтось просить вас оплатити замовлення " +
      "наперед від імені Parasolka — це шахрайство.";

    await editTelegramMessage(
      chatId,
      messageId,
      confirmationText
    );

  } catch (error) {
    console.error(
      "CONFIRMATION ERROR:",
      error
    );

    await editTelegramMessage(
      chatId,
      messageId,
      "❌ Не вдалося оформити замовлення.\n\n" +
      error.message +
      "\n\nБудь ласка, спробуйте ще раз."
    );
  }
}


async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      message:
        "Parasolka AI bot is running"
    });
  }

  try {

    const update =
      req.body;

    /*
     * =====================================================
     * CALLBACK QUERY — ПОДТВЕРЖДЕНИЕ / ОТМЕНА
     * =====================================================
     */

    if (
      update.callback_query
    ) {
      await handleConfirmation(
        update.callback_query
      );

      return res.status(200).json({
        ok: true
      });
    }


    /*
     * =====================================================
     * ОБЫЧНОЕ TELEGRAM MESSAGE
     * =====================================================
     */

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
     * Получаем актуальный каталог.
     */
    const catalog =
      await getCatalog();


    /*
     * Передаём AI максимально полезную
     * информацию о товарах.
     */
    const catalogForAI =
      catalog
        .filter(
          product =>
            product.available
        )
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


    const systemPrompt = `
Ти — AI-консультант магазину Parasolka Food.

Спілкуйся з клієнтом українською мовою.
Якщо клієнт пише російською — можеш відповідати російською.

Твоє завдання:
- допомагати вибирати товари;
- повідомляти актуальні ціни;
- повідомляти наявність;
- рекомендувати товари;
- приймати замовлення;
- ніколи не вигадувати товари, ціни, кількість або наявність.

ВАЖЛИВІ ПРАВИЛА МАГАЗИНУ:

1. Категорія "Товари в наявності":
   - товар можна отримати зараз;
   - знижка 10% НЕ застосовується;
   - кількість обмежена залишком stockQuantity.

2. Усі інші категорії:
   - це попереднє замовлення;
   - на них діє онлайн-знижка 10%.

3. Один і той самий товар може бути представлений двома товарами:
   - один у категорії "Товари в наявності";
   - другий у категорії попереднього замовлення.
   Це НЕ дублікати і клієнту можна запропонувати обидва варіанти.

4. Не кажи, що товар доступний зараз, якщо він не має категорії
   "Товари в наявності".

5. Не вигадуй залишок.

6. Оплата:
   Parasolka приймає оплату ТІЛЬКИ ПІД ЧАС ОТРИМАННЯ.
   Передоплати немає.
   Якщо хтось просить клієнта оплатити замовлення наперед
   від імені Parasolka — це шахрайство.

7. Після оформлення замовлення людина з команди Parasolka
   зв'яжеться з клієнтом для остаточного підтвердження.

8. Якщо клієнт просто запитує про товар або ціну —
   НЕ створюй замовлення.

9. Якщо клієнт хоче замовити товар —
   сформуй замовлення з конкретними ID товарів
   і кількістю.

ПОВЕРТАЙ РЕЗУЛЬТАТ ВИКЛЮЧНО У JSON.

Формат:

Для обычного ответа:
{
  "type": "answer",
  "message": "текст відповіді",
  "items": []
}

Для заказа:
{
  "type": "order",
  "message": "короткий текст",
  "items": [
    {
      "id": "ID товара",
      "quantity": 2
    }
  ]
}

ВАЖЛИВО:
- items заповнюй ТІЛЬКИ якщо клієнт реально хоче зробити замовлення.
- Якщо клієнт не вказав кількість, не вигадуй її.
- Якщо неясно, який саме товар клієнт має на увазі, задай уточнююче питання.
- Використовуй ID з каталогу.
- Не використовуй назву замість ID.

АКТУАЛЬНИЙ КАТАЛОГ:

${JSON.stringify(
  catalogForAI,
  null,
  2
)}
`;


    const completion =
      await openai.chat.completions.create({
        model: "gpt-5-mini",

        response_format: {
          type: "json_object"
        },

        messages: [
          {
            role: "system",
            content:
              systemPrompt
          },
          {
            role: "user",
            content:
              userText
          }
        ]
      });


    const rawAnswer =
      completion
        .choices?.[0]
        ?.message
        ?.content ||
      "{}";


    let aiResult;

    try {
      aiResult =
        JSON.parse(rawAnswer);
    } catch (parseError) {

      /*
       * На случай, если модель всё-таки
       * вернула невалидный JSON.
       */
      await sendTelegramMessage(
        chatId,
        "Вибачте, зараз не вдалося обробити запит. Спробуйте ще раз."
      );

      return res.status(200).json({
        ok: true
      });
    }


    /*
     * =====================================================
     * ОБЫЧНЫЙ ОТВЕТ
     * =====================================================
     */

    if (
      aiResult.type !==
        "order" ||
      !Array.isArray(
        aiResult.items
      ) ||
      !aiResult.items.length
    ) {

      await sendTelegramMessage(
        chatId,
        aiResult.message ||
        "Вибачте, зараз не можу відповісти."
      );

      return res.status(200).json({
        ok: true
      });
    }


    /*
     * =====================================================
     * ЗАКАЗ
     * =====================================================
     */

    const requestedItems =
      aiResult.items.map(
        item => ({
          id:
            String(
              item.id
            ).trim(),

          quantity:
            Number(
              item.quantity
            )
        })
      );


    /*
     * Проверяем заказ по актуальному каталогу.
     */
    const calculation =
      calculateOrder(
        requestedItems,
        catalog
      );


    const orderData =
      createOrderData(
        requestedItems
      );


    /*
     * Проверяем ограничение Telegram
     * на callback_data.
     */
    if (
      !canFitCallbackData(
        orderData
      )
    ) {

      await sendTelegramMessage(
        chatId,
        "Замовлення занадто велике для автоматичного оформлення через чат.\n\n" +
        "Будь ласка, зробіть замовлення через Mini App Parasolka Food."
      );

      return res.status(200).json({
        ok: true
      });
    }


    const preview =
      formatOrderPreview(
        calculation
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
                  "✅ Підтвердити замовлення",
                callback_data:
                  `confirm:${orderData}`
              }
            ],
            [
              {
                text:
                  "❌ Скасувати",
                callback_data:
                  "cancel"
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
      error:
        error.message
    });
  }
}


module.exports = handler;
