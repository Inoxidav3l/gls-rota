"use strict";

/* =========================================================
   Cloud Function: extractAddress

   Recebe a foto de uma etiqueta GLS (base64) e devolve a
   morada de entrega, lida por um modelo Gemini. A chave da
   API Gemini vive só aqui (variável de ambiente), nunca no
   código do browser — a Gemini, ao contrário da Maps, não
   suporta restringir a chave por site (HTTP referrer), só
   por IP, o que não serve para uma PWA usada em rede móvel.
   ========================================================= */

const { GoogleGenAI } = require("@google/genai");

// Só aceita pedidos vindos da tua app publicada no GitHub Pages.
const ALLOWED_ORIGIN = "https://inoxidav3l.github.io";

// Cabeçalho extra opcional — mesmo valor que puseres na env var
// APP_SECRET. Não é segurança "a sério" (a app é pública), mas
// evita que a função seja usada por quem apenas encontrar o URL.
const APP_SECRET = process.env.APP_SECRET || "";

const MODEL = "gemini-2.5-flash-lite"; // mais barato, chega perfeitamente para ler uma etiqueta

// ~4.5 MB de imagem em base64 — margem generosa para uma foto de telemóvel comprimida
const MAX_IMAGE_BASE64_CHARS = 6_000_000;

const PROMPT = `Esta imagem é a etiqueta de uma encomenda GLS.
Lê a morada de ENTREGA (destinatário) impressa na etiqueta.

Responde APENAS com a morada, numa única linha, neste formato:
Rua/Avenida, número, código postal, localidade

Não incluas o nome do destinatário, número de encomenda, código de barras,
nem qualquer outro texto antes ou depois da morada.

Se não conseguires ler a morada com confiança, responde exatamente:
SEM_MORADA`;

let aiClient = null;
function getClient() {
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return aiClient;
}

// A resposta da API vem em interaction.outputs — um array de blocos de
// conteúdo (texto, imagem, etc.). Para um pedido só-de-texto como este,
// juntamos o texto de todos os blocos do tipo "text".
function extractOutputText(interaction) {
  const outputs = interaction && interaction.outputs;
  if (!Array.isArray(outputs)) return "";
  return outputs
    .filter((o) => o && o.type === "text" && typeof o.text === "string")
    .map((o) => o.text)
    .join("");
}

function setCors(res) {
  res.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, x-app-secret");
}

exports.extractAddress = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }
  if (APP_SECRET && req.get("x-app-secret") !== APP_SECRET) {
    res.status(401).json({ error: "Não autorizado." });
    return;
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY não está configurada nesta função.");
    res.status(500).json({ error: "Função mal configurada (falta a chave Gemini)." });
    return;
  }

  const { image, mimeType } = req.body || {};
  if (!image || typeof image !== "string") {
    res.status(400).json({ error: "Falta a imagem." });
    return;
  }
  if (image.length > MAX_IMAGE_BASE64_CHARS) {
    res.status(413).json({ error: "Imagem demasiado grande." });
    return;
  }

  try {
    const ai = getClient();
    const interaction = await ai.interactions.create({
      model: MODEL,
      input: [
        { type: "text", text: PROMPT },
        { type: "image", data: image, mime_type: mimeType || "image/jpeg" },
      ],
    });

    if (interaction && interaction.status && interaction.status !== "completed") {
      console.warn("Interação Gemini terminou com estado:", interaction.status);
    }

    const text = extractOutputText(interaction).trim();
    if (!text || text.toUpperCase() === "SEM_MORADA") {
      res.status(200).json({ address: null });
      return;
    }
    res.status(200).json({ address: text });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Falha ao contactar a Gemini." });
  }
};
