// =====================================
// IMPORTAÇÕES
// =====================================
const fs = require("fs");
const QRCode = require("qrcode");
const { Client, RemoteAuth, MessageMedia } = require("whatsapp-web.js");
const { MongoStore } = require("wwebjs-mongo");
const mongoose = require("mongoose");
const { google } = require("googleapis");
const moment = require("moment-timezone");
require("dotenv").config();

console.log("🔧 INICIANDO BOT - FUNIL COMPLETO");

// =====================================
// FUNÇÃO DELAY
// =====================================
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// =====================================
// CONFIGURAÇÕES
// =====================================
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const MONGODB_URI = process.env.MONGODB_URI;

let sheets;
let client;
let enviadosHoje = 0;
const MAX_POR_DIA = 70;
const INTERVALO_MIN = 10 * 60 * 1000;
const INTERVALO_MAX = 15 * 60 * 1000;
const PAUSA_ENTRE_CICLOS = 5 * 60 * 1000;

// =====================================
// CONEXÃO GOOGLE SHEETS
// =====================================
async function conectarPlanilha() {
  console.log("📡 Conectando ao Google Sheets...");
  try {
    const auth = new google.auth.JWT(
      GOOGLE_CLIENT_EMAIL,
      null,
      GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID });
    console.log("✅ Planilha conectada!");
    return true;
  } catch (error) {
    console.error("❌ Erro na planilha:", error.message);
    return false;
  }
}

// =====================================
// FORMATAR TELEFONE (suporte internacional)
// =====================================
function formatarTelefone(telefone) {
  if (!telefone) return null;
  let numero = telefone.toString().replace(/\D/g, '');

  // Se já tem DDI (mais de 11 dígitos), usa como está
  // Se tem 11 dígitos (BR com DDD+9), adiciona 55
  // Se tem 10 dígitos (BR com DDD sem 9), adiciona 55
  if (numero.length <= 11) {
    numero = '55' + numero;
  }

  return `${numero}@c.us`;
}

// =====================================
// BUSCAR CONTATOS
// =====================================
async function buscarContatosParaAbordar() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'A:E'
    });
    const rows = response.data.values || [];
    if (rows.length <= 1) return [];

    const agora = moment().tz("America/Sao_Paulo");
    const hora = agora.hour();
    if (hora < 8 || hora >= 18 || agora.day() === 0 || agora.day() === 6) {
      console.log("⏰ Fora do horário comercial.");
      return [];
    }
    if (enviadosHoje >= MAX_POR_DIA) {
      console.log(`📊 Limite diário atingido: ${enviadosHoje}/${MAX_POR_DIA}`);
      return [];
    }

    const contatos = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const nomeEmpresa = row[0] || "Empresa";
      const telefone = row[1];
      const status = row[2] || "NAO_INICIADO";
      const etapa = parseInt(row[3]) || 0;
      const ultimoContato = row[4];

      if (["CONVERTIDO", "ERRO", "AGUARDANDO_RESPOSTA", "AGUARDANDO_ENVIO"].includes(status)) {
        continue;
      }

      let precisaFollowUp = false;
      if (ultimoContato && status === "AGUARDANDO_RESPOSTA") {
        const diasSemResposta = moment().diff(moment(ultimoContato, "DD/MM/YYYY HH:mm:ss"), "days");
        if (diasSemResposta >= 5) precisaFollowUp = true;
      }

      if ((status === "NAO_INICIADO" || precisaFollowUp) && telefone) {
        contatos.push({
          telefone: formatarTelefone(telefone),
          nomeEmpresa,
          linha: i + 1,
          precisaFollowUp,
          etapaAtual: etapa
        });
      }
    }
    console.log(`📋 Contatos para abordar: ${contatos.length}`);
    return contatos;
  } catch (error) {
    console.error("❌ Erro buscar contatos:", error);
    return [];
  }
}

// =====================================
// ATUALIZAR STATUS
// =====================================
async function atualizarStatus(linha, status, etapa, observacao = "") {
  try {
    const dataHora = moment().tz("America/Sao_Paulo").format("DD/MM/YYYY HH:mm:ss");
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `C${linha}:E${linha}`,
      valueInputOption: 'RAW',
      resource: { values: [[status, etapa, dataHora]] }
    });
    console.log(`📝 Linha ${linha}: ${status} | Etapa ${etapa}`);
    return true;
  } catch (error) {
    console.error("❌ Erro atualizar status:", error);
    return false;
  }
}

// =====================================
// ENVIAR MENSAGEM (FUNIL COMPLETO)
// =====================================
async function enviarMensagem(telefone, nomeEmpresa, etapaAtual, linha) {
  try {
    const chat = await client.getChatById(telefone);
    await chat.sendStateTyping();
    await delay(3000);

    if (etapaAtual === 0) {
      await client.sendMessage(telefone, `Olá, tudo bem? 👋`);
      await atualizarStatus(linha, "AGUARDANDO_RESPOSTA", 1, "MSG 1 enviada");
      console.log(`📨 MSG 1 → ${nomeEmpresa}`);
    }
    else if (etapaAtual === 1) {
      await client.sendMessage(telefone, `Queria falar com a responsável pela agenda ou atendimento, por favor.`);
      await atualizarStatus(linha, "AGUARDANDO_RESPOSTA", 2, "MSG 2 enviada");
      console.log(`📨 MSG 2 → ${nomeEmpresa}`);
    }
    else if (etapaAtual === 2) {
      await client.sendMessage(telefone, `Boa \n\nPesquisei por cílios na sua região e vi que tem bastante gente procurando, mas muitos perfis não estão aproveitando esse movimento.\n\nQueria te mostrar algo rápido sobre isso, pode ser?`);
      await atualizarStatus(linha, "AGUARDANDO_RESPOSTA", 3, "MSG 3 enviada");
      console.log(`📨 MSG 3 → ${nomeEmpresa}`);
    }
    else if (etapaAtual === 3) {
      await client.sendMessage(telefone, `Vou te mostrar uma ferramenta. Você consegue ver em tempo real:\n\nhttps://analise-perfil-google.lovable.app/\n\nDepois me fala o que apareceu aí pra você que te explico melhor!`);
      console.log(`📨 MSG 4 → ${nomeEmpresa}`);
      await delay(30000);
      try {
        const audio = MessageMedia.fromFilePath("/app/audio4.ogg");
        await client.sendMessage(telefone, audio);
        console.log(`🎙️ Áudio enviado → ${nomeEmpresa}`);
      } catch (audioError) {
        console.log("⚠️ Áudio não encontrado, continuando sem ele...");
      }
      await atualizarStatus(linha, "CONVERTIDO", 4, "MSG 4 + áudio enviados");
    }
    return true;
  } catch (error) {
    console.error(`❌ Erro ao enviar para ${nomeEmpresa}:`, error.message);
    await atualizarStatus(linha, "ERRO", etapaAtual, error.message);
    return false;
  }
}

// =====================================
// PROCESSAR RESPOSTA
// =====================================
async function processarResposta(telefone, texto, nomeContato) {
  console.log(`📥 Resposta de ${nomeContato} (${telefone}): "${texto.substring(0, 50)}"`);
  try {
    if (!sheets) await conectarPlanilha();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'A:E'
    });
    const rows = response.data.values || [];
    const telefoneFormatado = formatarTelefone(telefone);

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const telefonePlanilha = formatarTelefone(row[1]);

      if (telefoneFormatado === telefonePlanilha) {
        const status = row[2] || "";
        const etapa = parseInt(row[3]) || 0;
        const nomeEmpresa = row[0] || nomeContato;

        console.log(`🔍 Lead: ${nomeEmpresa} | Status: ${status} | Etapa: ${etapa}`);

        if (status === "AGUARDANDO_RESPOSTA" && etapa < 4) {
          console.log(`⏳ Aguardando 15s antes de enviar próxima mensagem...`);
          await delay(15000);
          await enviarMensagem(telefoneFormatado, nomeEmpresa, etapa, i + 1);
        } else {
          console.log(`ℹ️ ${nomeEmpresa} não precisa de resposta agora (status: ${status}, etapa: ${etapa})`);
        }
        return;
      }
    }
    console.log(`⚠️ Telefone ${telefone} não encontrado na planilha.`);
  } catch (error) {
    console.error("❌ Erro ao processar resposta:", error);
  }
}

// =====================================
// PROSPECÇÃO CONTÍNUA
// =====================================
async function iniciarProspeccaoContinua() {
  console.log("\n🚀 Iniciando prospecção contínua...");
  if (!sheets) await conectarPlanilha();

  while (true) {
    const contatos = await buscarContatosParaAbordar();
    if (contatos.length === 0) {
      console.log(`📭 Nenhum contato. Aguardando ${PAUSA_ENTRE_CICLOS / 60000} min...`);
      await delay(PAUSA_ENTRE_CICLOS);
      continue;
    }

    let primeiroEnvio = true;
    for (const contato of contatos) {
      if (enviadosHoje >= MAX_POR_DIA) {
        console.log("⏸️ Limite diário atingido. Aguardando 12h...");
        await delay(12 * 60 * 60 * 1000);
        enviadosHoje = 0;
        break;
      }

      if (!primeiroEnvio) {
        const intervalo = Math.floor(Math.random() * (INTERVALO_MAX - INTERVALO_MIN + 1) + INTERVALO_MIN);
        console.log(`⏱️ Aguardando ${Math.round(intervalo / 60000)} min antes do próximo...`);
        await delay(intervalo);
      } else {
        console.log(`⚡ Primeiro lead: envio imediato!`);
        primeiroEnvio = false;
      }

      console.log(contato.precisaFollowUp ? `🔄 Follow-up: ${contato.nomeEmpresa}` : `📞 Novo lead: ${contato.nomeEmpresa}`);
      await enviarMensagem(contato.telefone, contato.nomeEmpresa, contato.etapaAtual, contato.linha);
      enviadosHoje++;
    }
    console.log(`✅ Lote finalizado. Aguardando ${PAUSA_ENTRE_CICLOS / 60000} min...`);
    await delay(PAUSA_ENTRE_CICLOS);
  }
}

// =====================================
// INICIALIZAR BOT
// =====================================
async function iniciarBot() {
  console.log("📡 Conectando ao MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("✅ MongoDB conectado!");

  // Garante diretório com permissão de escrita para o RemoteAuth
  const authDir = "/tmp/wwebjs_auth";
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
  process.chdir(authDir);
  console.log(`📁 Diretório de trabalho: ${authDir}`);

  const store = new MongoStore({ mongoose });

  console.log("📌 Criando cliente WhatsApp com RemoteAuth...");
  client = new Client({
    authStrategy: new RemoteAuth({
      store,
      backupSyncIntervalMs: 300000,
      dataPath: authDir
    }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
      ],
    },
  });

  client.on("loading_screen", (percent) => {
    console.log(`⏳ Carregando WhatsApp: ${percent}%`);
  });

  client.on("qr", async (qr) => {
    console.log("\n📲 QR CODE GERADO!\n");
    try {
      const qrDataUrl = await QRCode.toDataURL(qr, { width: 500, margin: 2 });
      await QRCode.toFile("/tmp/qrcode.png", qr, { width: 500, margin: 2 });
      console.log("✅ QR salvo em /tmp/qrcode.png");
      console.log("🔗 Cole o link abaixo no navegador para visualizar o QR:");
      console.log("\n👉 " + qrDataUrl + "\n");
    } catch (e) {
      console.error("Erro ao gerar QR:", e.message);
    }
    console.log("⚠️  Você tem 60 segundos para escanear!\n");
  });

  client.on("authenticated", () => {
    console.log("🔐 WhatsApp autenticado!");
  });

  client.on("ready", () => {
    console.log("✅ WhatsApp conectado e pronto!");
    iniciarProspeccaoContinua().catch(console.error);
  });

  // ✅ LISTENER DE MENSAGENS
  client.on("message", async (msg) => {
    if (msg.fromMe) return;
    if (msg.from.includes("@g.us")) return;

    const telefone = msg.from.replace("@c.us", "");
    const texto = msg.body || "";

    let nomeContato = telefone;
    try {
      const contact = await msg.getContact();
      nomeContato = contact.pushname || contact.name || telefone;
    } catch (_) {}

    await processarResposta(telefone, texto, nomeContato);
  });

  client.on("auth_failure", (msg) => {
    console.error("❌ Falha na autenticação:", msg);
  });

  client.on("disconnected", (reason) => {
    console.log("⚠️ WhatsApp desconectado:", reason);
    console.log("🔄 Reiniciando em 15s...");
    setTimeout(() => {
      client.initialize().catch(console.error);
    }, 15000);
  });

  // Captura erro global para não crashar no RemoteAuth.zip
  process.on("uncaughtException", (err) => {
    if (err.code === "ENOENT" && err.path && err.path.includes("RemoteAuth")) {
      console.warn("⚠️ Aviso RemoteAuth (não crítico):", err.message);
      return;
    }
    console.error("❌ Erro não tratado:", err);
  });

  console.log("🚀 Inicializando cliente WhatsApp...");
  await client.initialize();
}

// =====================================
// START
// =====================================
iniciarBot().catch((err) => {
  console.error("❌ Erro fatal:", err);
  process.exit(1);
});
