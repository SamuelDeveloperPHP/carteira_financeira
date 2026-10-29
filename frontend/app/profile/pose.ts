// Matemática da prova de vida. Funções puras, sem DOM: recebem os 68 pontos do
// rosto (modelo "face_landmark_68") e devolvem razões geométricas.
//
// Referência dos pontos: 0 e 16 = extremos do contorno (maxilar), 8 = queixo,
// 30 = ponta do nariz, 36..47 = olhos.
//
// A câmera NÃO espelha a imagem que o modelo analisa. Então, quando a pessoa
// vira o rosto para a SUA direita, o nariz se desloca para a ESQUERDA da imagem
// (a razão `yaw` diminui). A tela mostra o vídeo espelhado só para parecer um
// espelho; a análise usa o quadro original.

export type Point = { x: number; y: number };
export type Step = "right" | "left" | "down" | "up" | "smile";

/** Ordem pedida ao usuário: direita, esquerda, abaixar, levantar, sorrir. */
export const STEPS: { id: Step; text: string }[] = [
  { id: "right", text: "Vire o rosto para a direita" },
  { id: "left", text: "Vire o rosto para a esquerda" },
  { id: "down", text: "Abaixe a cabeça" },
  { id: "up", text: "Levante a cabeça" },
  { id: "smile", text: "Sorria" },
];

export interface Pose {
  /** Posição horizontal do nariz entre os extremos do rosto: ~0,5 de frente. */
  yaw: number;
  /** Distância nariz-olhos dividida por queixo-olhos: sobe ao abaixar a cabeça, desce ao levantar. */
  pitch: number;
}

export function poseOf(p: Point[]): Pose {
  const nose = p[30];
  const width = p[16].x - p[0].x || 1;
  const eyes = p.slice(36, 48);
  const eyeY = eyes.reduce((sum, e) => sum + e.y, 0) / eyes.length;
  const height = p[8].y - eyeY || 1;
  return { yaw: (nose.x - p[0].x) / width, pitch: (nose.y - eyeY) / height };
}

// Quanto a pose precisa se afastar da pose de frente (medida no início).
const YAW_DELTA = 0.1;
const PITCH_DELTA = 0.07;
const SMILE_SCORE = 0.7;

/** O quadro atual cumpre a etapa? `base` é a pose de frente medida no começo. */
export function stepDone(
  step: Step,
  pose: Pose,
  base: Pose,
  happy: number
): boolean {
  switch (step) {
    case "right":
      return pose.yaw <= base.yaw - YAW_DELTA;
    case "left":
      return pose.yaw >= base.yaw + YAW_DELTA;
    case "down":
      return pose.pitch >= base.pitch + PITCH_DELTA;
    case "up":
      return pose.pitch <= base.pitch - PITCH_DELTA;
    case "smile":
      return happy >= SMILE_SCORE;
  }
}

/** Está olhando de frente (pose neutra)? Usado para medir a base e capturar o vetor facial. */
export const isFrontal = (pose: Pose) => pose.yaw > 0.42 && pose.yaw < 0.58;

/** Média de vários vetores faciais (reduz o ruído de um único quadro). */
export function averageVectors(vectors: number[][]): number[] {
  return vectors[0].map(
    (_, i) => vectors.reduce((s, v) => s + v[i], 0) / vectors.length
  );
}
