# Rota GLS — Fase 1

App instalável (PWA) que ordena as entregas do dia a partir do depósito, desenha a rota real num mapa, e abre a navegação por paragem.

## Como publicar

1. No repositório `Inoxidav3l/gls-rota`, faz upload de **todos** os ficheiros desta pasta (`index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.json`, os 4 ícones) diretamente para a raiz do repositório.
2. Settings → Pages → confirma Branch `main` / pasta `/root` (já deixaste isto configurado).
3. Espera 1-2 minutos e abre `https://inoxidav3l.github.io/gls-rota/`.

## Primeira utilização

1. Abre o link no telemóvel.
2. Toca no ícone de engrenagem (canto superior direito) → **Definições**.
3. Cola a tua chave da API Google Maps Platform.
4. Escreve a morada do depósito/armazém.
5. (Opcional) Escreve notas locais — atalhos, ruas a evitar, cortes. Estas aparecem sempre à vista quando calculares uma rota, mas **não são aplicadas automaticamente ao cálculo** (isso fica para uma fase seguinte).
6. Guardar.
7. Volta ao ecrã principal, no menu do navegador escolhe **"Adicionar ao ecrã inicial"** — passa a abrir como app, em ecrã inteiro.

## Uso diário

1. Abre a app.
2. Cola a lista de moradas do dia, uma por linha.
3. Toca em **Calcular rota**.
4. Vês o mapa com os pontos numerados na ordem sugerida, e a lista por baixo.
5. Toca em qualquer paragem da lista para abrir a navegação até lá no Google Maps.

## O que esta versão já faz

- Geocodifica cada morada (Google Geocoding API).
- Ordena as paragens pelo algoritmo nearest-neighbor + 2-opt (distância em linha reta — sem custo).
- Traça o percurso final com trânsito em tempo real (Routes API), 1 pedido por troço de ~24 paragens — mesmo com 60+ entregas, funciona (fragmenta automaticamente).
- Fica instalada como app, com ecrã inicial rápido mesmo com net fraca (o mapa e a rota em si precisam sempre de ligação).
- Guarda um cache local de moradas já geocodificadas, para poupares pedidos em clientes repetidos.

## O que ainda não faz (fases seguintes, como planeámos)

- Não aplica ainda as tuas notas locais ao cálculo da rota (só as mostra como lembrete).
- Sem ajustes por linguagem natural ainda ("põe X primeiro").
- Alerta de proximidade GPS — ainda por construir.

## Foto da etiqueta → morada automática

Agora dá para tocar em **📷 Foto da etiqueta**, tirar foto à etiqueta do pacote, e a morada aparece automaticamente numa nova linha na lista — já não precisas de escrever as 60+ moradas à mão. Isto usa um modelo Gemini para ler a etiqueta.

**Porque é que isto precisa de uma peça extra (a Cloud Function):** a chave da API Gemini, ao contrário da chave do Google Maps, não pode ser restrita por site (HTTP referrer) — só por IP, o que não serve para um telemóvel em rede móvel/wifi variável. Pôr essa chave diretamente no `app.js` deixava-a visível a qualquer pessoa que inspecionasse o código da app publicada. Por isso a chave Gemini vive só numa pequena função na Google Cloud (que já usas para o Maps), e a app fala com essa função — nunca diretamente com a Gemini.

### Deploy da função (só precisas de fazer isto uma vez)

Precisas do [gcloud CLI](https://cloud.google.com/sdk/docs/install) instalado e autenticado (`gcloud auth login`), e de uma chave de API Gemini — cria uma em [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

```bash
cd cloud-function
gcloud config set project gls-rota

gcloud functions deploy extractAddress \
  --gen2 \
  --runtime=nodejs20 \
  --region=europe-west1 \
  --source=. \
  --entry-point=extractAddress \
  --trigger-http \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=A_TUA_CHAVE_GEMINI,APP_SECRET=escolhe-uma-frase-qualquer
```

No fim, o comando mostra um `url:` — copia-o e cola-o no `app.js`, na constante `EXTRACT_ADDRESS_URL` (substitui o placeholder), e põe a mesma frase de `APP_SECRET` na constante `APP_SECRET` logo a seguir. Depois faz upload dos ficheiros atualizados (`app.js`, `index.html`, `styles.css`) para o repositório, como sempre.

**Recomendado:** na Google Cloud Console → Billing → Budgets & alerts, define um orçamento baixo (ex.: €2/mês) com alerta, como rede de segurança extra. Ao teu volume de fotos, o custo real com `gemini-2.5-flash-lite` deve ficar bem abaixo disso — mas o alerta avisa-te se algo correr mal.

## Nota de segurança

A tua chave da API Google Maps fica guardada só no armazenamento local do teu telemóvel/navegador (nunca é enviada para mim nem para mais lado nenhum além da Google). A chave da API Gemini nunca chega ao telemóvel — fica só na Cloud Function, como explicado acima. Se limpares os dados do navegador ou trocares de telemóvel, tens de inserir de novo a chave do Maps.
