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
- Não interpreta moradas mal escritas com IA — se uma morada não for encontrada, aparece marcada como "não localizada" no resumo.
- Sem ajustes por linguagem natural ainda ("põe X primeiro").

## Nota de segurança

A tua chave de API fica guardada só no armazenamento local do teu telemóvel/navegador (nunca é enviada para mim nem para mais lado nenhum além da Google). Se limpares os dados do navegador ou trocares de telemóvel, tens de a inserir de novo.
