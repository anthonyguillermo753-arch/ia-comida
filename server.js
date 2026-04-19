require("dotenv").config();


const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

let conversaciones = {};

const app = express();
app.use(cors());
app.use(express.json());

const uri = "mongodb://anthonyguillermo753_db_user:T9V3VGyNBMPmc4oe@ac-idyacmh-shard-00-00.pitwhnb.mongodb.net:27017,ac-idyacmh-shard-00-01.pitwhnb.mongodb.net:27017,ac-idyacmh-shard-00-02.pitwhnb.mongodb.net:27017/?ssl=true&replicaSet=atlas-1nqbng-shard-0&authSource=admin&appName=Cluster0";

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 5000,
  family: 4
});

let db;

async function conectarDB() {
  await client.connect();
  db = client.db("miapp");
  console.log("Conectado a MongoDB 🚀");
}

conectarDB();

app.post("/chat", async (req, res) => {
  const mensaje = req.body.mensaje;
  const userId = req.body.userId;
  const chatId = req.body.chatId;
  const input = req.body.mensaje.toLowerCase();

function normalizarTexto(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD") // quita tildes
    .replace(/[\u0300-\u036f]/g, "") // elimina acentos
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

const stopwords = [
  "quiero", "quisiera", "gustaria", "me",
  "comer", "deseo", "porfa", "porfavor",
  "un", "una", "el", "la", "al"
];

const palabras = input
  .split(" ")
  .map(p => normalizarTexto(p))
  .filter(p => p.length > 2 && !stopwords.includes(p));

  const restaurantes = await db.collection("negocios").find().toArray();

  const mensajeNormalizado = normalizarTexto(mensaje);

// 🔥 SALUDO
if (
  mensajeNormalizado.includes("hola") ||
  mensajeNormalizado.includes("buenas") ||
  mensajeNormalizado.includes("hey")
) {
  return res.json({
    content: "¡Hola! 👋 ¿Qué te gustaría comer hoy? Puedo ayudarte a encontrarlo 😄",
    restaurantes: []
  });
}


if (!conversaciones[userId]) {
  conversaciones[userId] = {};
}

if (!conversaciones[userId][chatId]) {
  conversaciones[userId][chatId] = [];
}

let historial = conversaciones[userId][chatId];

historial.push({
  role: "user",
  content: mensaje
});

await db.collection("mensajes").insertOne({
  userId,
  chatId,
  role: "user",
  content: mensaje,
  fecha: new Date()
});

if (historial.length > 6) {
  historial = historial.slice(-6);
}


let filtrados = restaurantes.map(r => {

  if (!r.abierto || !r.platos) return null;

  let mejorScore = 0;

  r.platos.forEach(p => {

    if (!p.disponible) return;

    const nombrePlato = normalizarTexto(p.nombre);

    const coincidencias = palabras.filter(palabra =>
      nombrePlato.includes(palabra)
    ).length;

    if (coincidencias > mejorScore) {
      mejorScore = coincidencias;
    }

  });

  if (mejorScore === 0) return null;

  return {
    ...r,
    score: mejorScore
  };

}).filter(r => r !== null);


if (filtrados.length === 0) {
  return res.json({
    content: "No encontré restaurantes con ese plato 😢",
    restaurantes: []
  });
}

let sugerencia = "";

if (filtrados.length === 0 && input.includes("comer")) {
  return res.json({
    content: "No encontré restaurantes con ese plato 😢",
    restaurantes: []
  });
}

if (mensajeNormalizado.includes("delivery")) {
  filtrados = filtrados.filter(r => r.delivery === true);
}

filtrados.sort((a, b) => {
  if (b.score === a.score) {
    return (b.rating || 0) - (a.rating || 0);
  }
  return b.score - a.score;
});

filtrados = filtrados.slice(0, 3);

  try {

const contextoRestaurantes = {
  role: "system",
  content: `Restaurantes mostrados recientemente: ${JSON.stringify(filtrados)}`
};


const response = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
  "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
  "Content-Type": "application/json"
},
body: JSON.stringify({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content: `
Eres un asistente inteligente que recomienda restaurantes en Ica.

CONTEXTO:
Estos son los restaurantes disponibles actualmente:
${JSON.stringify(filtrados)}

INSTRUCCIONES IMPORTANTES:
- Mantén el contexto de la conversación (como ChatGPT)
- Si el usuario dice "ese", "esa tienda", "el primero", "otro", refiérete a los restaurantes mostrados anteriormente
- Si el usuario pregunta por ubicación, responde con distrito y provincia
- Si pregunta por delivery, responde según los datos reales
- Si hace preguntas relacionadas, mantén coherencia con lo anterior
- No repitas toda la información si ya fue mostrada en tarjetas
- Responde de forma natural, como una conversación humana
- Sé útil, claro y coherente
- No inventes información

FORMA DE RESPONDER:
- Primero responde con una frase breve
- Luego el sistema mostrará las tarjetas (no las repitas)
- Si el usuario hace seguimiento (ej: "dónde queda", "tiene delivery"), responde directamente sobre lo último mencionado
`

  },
contextoRestaurantes,  
...historial,
 {
    role: "user",
    content: mensaje
  }
]
})
});

    const data = await response.json();

    if (!data.choices) {
      console.log(data);
      return res.json({
        content: "Error con la IA 😢 revisa API key o saldo"
      });
    }

historial.push(data.choices[0].message);

await db.collection("mensajes").insertOne({
  userId: userId,
  chatId: chatId,
  role: "assistant",
  content: data.choices[0].message.content,
  restaurantes: filtrados, // 🔥 NUEVO
  fecha: new Date()
});

    res.json({
  content: data.choices[0].message.content,
  restaurantes: filtrados
});

} catch (error) {
  console.error("🔥 ERROR REAL:", error);

  res.json({
    content: "Error del servidor 😢"
  });
}

app.get("/historial", async (req, res) => {
  const userId = req.query.userId;
  const chatId = req.query.chatId;

  const mensajes = await db.collection("mensajes")
    .find({ userId: userId, chatId: chatId })
    .sort({ fecha: 1 })
    .toArray();

  res.json(mensajes);
});

app.post("/guardar-negocio", async (req, res) => {
  const data = req.body;

  try {
    
await db.collection("negocios").updateOne(
  { ownerId: req.body.ownerId }, // 🔥 busca por usuario
  { $set: req.body },            // 🔥 actualiza datos
  { upsert: true }               // 🔥 si no existe, crea
);

    res.json({ mensaje: "Guardado correctamente" });

  } catch (error) {
    console.log(error);
    res.status(500).json({ mensaje: "Error al guardar" });
  }
});

app.get("/negocios", async (req, res) => {
  try {
    const negocios = await db.collection("negocios").find().toArray();
    res.json(negocios);
  } catch (error) {
    console.log(error);
    res.status(500).json({ mensaje: "Error al obtener negocios" });
  }
});

app.get("/usuarios", async (req, res) => {
  try {
    const usuarios = await db.collection("usuarios").find().toArray();
    res.json(usuarios);
  } catch (error) {
    res.status(500).json({ mensaje: "Error al obtener usuarios" });
  }
});

app.post("/agregar-comentario", async (req, res) => {
  const { nombreNegocio, texto, rating } = req.body;

  try {
    const negocio = await db.collection("negocios").findOne({
      nombre: nombreNegocio
    });

    if (!negocio) {
      return res.status(404).json({ mensaje: "Negocio no encontrado" });
    }

    // 🔥 agregar comentario
    const nuevosComentarios = [
      ...(negocio.comentarios || []),
      { texto, rating }
    ];

    // 🔥 calcular promedio
    const promedio =
      nuevosComentarios.reduce((acc, c) => acc + c.rating, 0) /
      nuevosComentarios.length;

    // 🔥 guardar todo
    await db.collection("negocios").updateOne(
      { nombre: nombreNegocio },
      {
        $set: {
          comentarios: nuevosComentarios,
          ratingPromedio: parseFloat(promedio.toFixed(1))
        }
      }
    );

    res.json({ mensaje: "Comentario guardado" });

  } catch (error) {
    console.log(error);
    res.status(500).json({ mensaje: "Error al guardar comentario" });
  }
});


app.post("/registro", async (req, res) => {
  const { nombre, email, password, tipo } = req.body;

  try {
    await db.collection("usuarios").insertOne({
      nombre,
      email,
      password,
      tipo // "cliente" o "proveedor"
    });

    res.json({ mensaje: "Usuario creado" });

  } catch (error) {
    console.log(error);
    res.status(500).json({ mensaje: "Error al registrar" });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await db.collection("usuarios").findOne({ email, password });

    if (!user) {
      return res.status(401).json({ mensaje: "Credenciales incorrectas" });
    }

    res.json(user);

  } catch (error) {
    console.log(error);
    res.status(500).json({ mensaje: "Error en login" });
  }
});

app.listen(3000, () => {
  console.log("Servidor corriendo en http://localhost:3000");
});
