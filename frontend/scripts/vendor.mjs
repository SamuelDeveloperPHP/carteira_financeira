// Copia para public/vendor os arquivos de terceiros que o navegador carrega
// sob demanda (biblioteca de reconhecimento facial e seus modelos). Roda antes
// do build e do dev (scripts "prebuild" e "predev"), então nada disso é
// versionado: vem sempre da versão travada em package-lock.json.
import { cpSync, mkdirSync, existsSync } from "node:fs";

const source = "node_modules/@vladmandic/face-api";
const target = "public/vendor";
if (!existsSync(source))
  throw new Error("Instale as dependências antes (npm ci).");

mkdirSync(`${target}/face-models`, { recursive: true });
cpSync(`${source}/dist/face-api.js`, `${target}/face-api.js`);
// Só os modelos usados: detector leve, 68 pontos do rosto, vetor facial e expressões (sorriso).
for (const model of [
  "tiny_face_detector_model",
  "face_landmark_68_model",
  "face_recognition_model",
  "face_expression_model",
]) {
  cpSync(
    `${source}/model/${model}-weights_manifest.json`,
    `${target}/face-models/${model}-weights_manifest.json`
  );
  cpSync(`${source}/model/${model}.bin`, `${target}/face-models/${model}.bin`);
}
