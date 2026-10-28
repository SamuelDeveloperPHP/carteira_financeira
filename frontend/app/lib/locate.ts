import { geoHintOff } from "../profile/geo-hint";
import type { LocationData } from "./types";

// Pede a localização ao navegador no login, para a auditoria. É OPCIONAL: se o
// usuário negar, o sistema registra "denied" e o login segue normalmente. O
// timeout de 7 s evita travar a tela esperando o GPS.
export async function locate(): Promise<LocationData> {
  // Quem desligou a geolocalização no perfil não é incomodado com o pedido.
  if (!navigator.geolocation || geoHintOff()) return { status: "unavailable" };
  return new Promise(resolve =>
    navigator.geolocation.getCurrentPosition(
      p =>
        resolve({
          status: "granted",
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: p.coords.accuracy,
          capturedAt: new Date(p.timestamp).toISOString(),
        }),
      e =>
        resolve({
          status:
            e.code === 1 ? "denied" : e.code === 3 ? "timeout" : "unavailable",
        }),
      // Alta precisão (GPS/Wi-Fi) e posição fresca: base da trilha de acesso.
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  );
}
