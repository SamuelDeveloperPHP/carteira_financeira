"use client";
/*
 * Captura facial com PROVA DE VIDA, usada no cadastro do rosto e na
 * recuperação de senha.
 *
 * Sequência: olhar de frente (mede a pose neutra e colhe o vetor facial) ->
 * virar à direita -> virar à esquerda -> abaixar a cabeça -> levantar a cabeça
 * -> sorrir. Cada etapa precisa ser mantida por alguns quadros seguidos.
 *
 * Tudo roda NO NAVEGADOR (face-api.js, modelos servidos pelo próprio site, sem
 * chamar serviços externos) e o vídeo nunca é enviado: só o vetor de 128
 * números sai daqui. Limite honesto: como o navegador é controlado por quem o
 * usa, a prova de vida dificulta fotos e vídeos, mas não é à prova de fraude;
 * por isso o servidor combina o rosto com o link do e-mail na recuperação.
 */
import { useEffect, useRef, useState } from "react";
import { averageVectors, isFrontal, poseOf, Pose, Step, STEPS, stepDone } from "./pose";

declare global {
  interface Window {
    faceapi?: any;
  }
}

const VENDOR = "/vendor";
const FRAMES_TO_CONFIRM = 3; // quadros seguidos que confirmam uma etapa
const FRONT_VECTORS = 3; // vetores colhidos de frente para fazer a média
const STEP_TIMEOUT_MS = 25000;
const TICK_MS = 180;

let modelsReady: Promise<any> | null = null;

/** Carrega a biblioteca (script local) e os modelos uma única vez. */
function loadFaceApi(): Promise<any> {
  modelsReady ??= (async () => {
    if (!window.faceapi)
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = `${VENDOR}/face-api.js`;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Não foi possível carregar o reconhecimento facial."));
        document.head.appendChild(script);
      });
    const api = window.faceapi;
    const uri = `${VENDOR}/face-models`;
    await Promise.all([
      api.nets.tinyFaceDetector.loadFromUri(uri),
      api.nets.faceLandmark68Net.loadFromUri(uri),
      api.nets.faceRecognitionNet.loadFromUri(uri),
      api.nets.faceExpressionNet.loadFromUri(uri),
    ]);
    return api;
  })().catch(error => {
    modelsReady = null; // permite tentar de novo
    throw error;
  });
  return modelsReady;
}

export type FaceResult = { descriptor: number[]; liveness: Step[] };

export function FaceCapture({
  onDone,
  onCancel,
}: {
  onDone: (result: FaceResult) => void;
  onCancel: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<"loading" | "front" | "steps" | "finished" | "error">("loading");
  const [index, setIndex] = useState(0);
  const [hint, setHint] = useState("Carregando o reconhecimento facial…");
  const [attempt, setAttempt] = useState(0); // incrementar reinicia tudo

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function run() {
      try {
        const faceapi = await loadFaceApi();
        if (stopped) return;
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("Este navegador não permite usar a câmera (é preciso HTTPS ou localhost).");
        setHint("Permita o uso da câmera…");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (stopped) return;
        const el = video.current!;
        el.srcObject = stream;
        await el.play();
        setPhase("front");
        setHint("Olhe de frente para a câmera.");

        const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
        let base: Pose | null = null;
        const vectors: number[][] = [];
        const done: Step[] = [];
        let streak = 0;
        let stepStarted = Date.now();
        // Cada passagem do laço lê UM quadro; `busy` evita acumular análises lentas.
        let busy = false;

        timer = setInterval(async () => {
          if (busy || stopped || el.readyState < 2) return;
          busy = true;
          try {
            const faces = await faceapi.detectAllFaces(el, options).withFaceLandmarks().withFaceExpressions();
            if (stopped) return;
            if (faces.length !== 1) {
              streak = 0;
              setHint(
                faces.length
                  ? "Apenas uma pessoa deve aparecer na câmera."
                  : "Não encontramos seu rosto. Centralize-o e melhore a luz."
              );
              return;
            }
            const face = faces[0];
            const pose = poseOf(face.landmarks.positions);

            // Fase 1: de frente. Mede a pose neutra e colhe o vetor facial.
            if (!base) {
              if (!isFrontal(pose)) {
                setHint("Olhe de frente para a câmera.");
                return;
              }
              const full = await faceapi.detectSingleFace(el, options).withFaceLandmarks().withFaceDescriptor();
              if (!full) return;
              vectors.push(Array.from(full.descriptor as Float32Array));
              if (vectors.length < FRONT_VECTORS) {
                setHint("Fique parado, olhando de frente…");
                return;
              }
              base = pose;
              stepStarted = Date.now();
              setPhase("steps");
              setIndex(0);
              setHint(STEPS[0].text);
              return;
            }

            // Fase 2: as cinco etapas, na ordem.
            const step = STEPS[done.length];
            if (Date.now() - stepStarted > STEP_TIMEOUT_MS) {
              clearInterval(timer);
              setPhase("error");
              setHint("Tempo esgotado nesta etapa. Tente novamente.");
              return;
            }
            if (stepDone(step.id, pose, base, face.expressions.happy ?? 0)) streak++;
            else streak = 0;
            if (streak < FRAMES_TO_CONFIRM) return;

            done.push(step.id);
            streak = 0;
            stepStarted = Date.now();
            if (done.length === STEPS.length) {
              clearInterval(timer);
              setPhase("finished");
              setIndex(STEPS.length);
              setHint("Tudo certo! Rosto verificado.");
              onDone({ descriptor: averageVectors(vectors), liveness: done });
              return;
            }
            setIndex(done.length);
            setHint(STEPS[done.length].text);
          } catch {
            // Falha pontual de um quadro: tenta o próximo.
          } finally {
            busy = false;
          }
        }, TICK_MS);
      } catch (e) {
        if (stopped) return;
        setPhase("error");
        const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
        setHint(
          denied
            ? "Permissão da câmera negada. Libere a câmera nas configurações do navegador."
            : e instanceof Error
              ? e.message
              : "Não foi possível iniciar a câmera."
        );
      }
    }
    setPhase("loading");
    setIndex(0);
    run();
    // Ao fechar: para o laço e DESLIGA a câmera (a luz do aparelho apaga).
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach(t => t.stop());
    };
    // `onDone` muda a cada render do pai; reiniciar a câmera por isso seria um erro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  return (
    <div className="face-capture">
      <div className="face-video">
        {/* Espelhado só na tela, para parecer um espelho; a análise usa o quadro original. */}
        <video ref={video} muted playsInline aria-label="Imagem da câmera" />
        {phase === "loading" && <div className="face-overlay">Preparando…</div>}
      </div>
      <p className="face-hint" role="status" aria-live="polite">
        {hint}
      </p>
      <ol className="face-steps" aria-label="Etapas da prova de vida">
        {STEPS.map((s, i) => (
          <li key={s.id} className={i < index ? "done" : i === index && phase === "steps" ? "current" : ""}>
            {i < index ? "✓ " : ""}
            {s.text}
          </li>
        ))}
      </ol>
      <div className="inline-actions">
        {phase === "error" && (
          <button type="button" className="btn btn-primary" onClick={() => setAttempt(n => n + 1)}>
            Tentar novamente
          </button>
        )}
        <button type="button" className="btn btn-outline-secondary" onClick={onCancel}>
          {phase === "finished" ? "Fechar" : "Cancelar"}
        </button>
      </div>
    </div>
  );
}
