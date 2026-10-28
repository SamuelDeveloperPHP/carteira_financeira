// Dica local sobre a preferência de geolocalização.
//
// A tela de login ainda não sabe quem vai entrar, então não pode consultar a
// preferência no servidor. Depois do primeiro login neste navegador, guardamos
// só "ligada" ou "desligada" para NÃO pedir a localização a quem a desligou.
// É apenas um atalho de conforto: quem decide é o servidor, que descarta a
// localização recebida quando a preferência está desligada.
const KEY = "wallet.geolocation";

export function setGeoHint(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Armazenamento bloqueado (janela privada): sem a dica, apenas pedimos a localização.
  }
}

export function geoHintOff(): boolean {
  try {
    return localStorage.getItem(KEY) === "off";
  } catch {
    return false;
  }
}
