# LoL Squad Board

Board local para seguir a tus amigos en League of Legends con datos reales de Riot API.

## Requisitos

- Node.js 18 o superior
- Una `RIOT_API_KEY` valida desde el portal de Riot

## Configuracion

1. Edita `accounts.json` con el Riot ID de cada amigo:
   - `gameName`: nombre antes del `#`
   - `tagLine`: texto despues del `#`
   - `platform`: por ejemplo `LA1`, `LA2`, `NA1`, `EUW1`, `KR`
2. Define la variable de entorno `RIOT_API_KEY`.

## Ejecutar en PowerShell

```powershell
$env:RIOT_API_KEY="tu_api_key"
node server.js
```

Luego abre `http://127.0.0.1:3000`.

## Notas

- El backend usa `account-v1`, `summoner-v4`, `league-v4` y `match-v5`.
- La tabla muestra rango actual, LP, wins/losses y streak real.
- La grafica usa una tendencia real de las ultimas 12 partidas ranked SoloQ.
- Las development keys de Riot expiran cada 24 horas, asi que tendras que renovarla periodicamente.
