FROM dh-mirror.gitverse.ru/library/node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

CMD ["node", "bot.js"]