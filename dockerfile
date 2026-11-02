FROM node:24-alpine

WORKDIR /app

# Копируем файлы зависимостей
COPY package*.json ./

# Устанавливаем зависимости (используем npm install вместо npm ci)
RUN npm install --omit=dev

# Копируем остальные файлы проекта
COPY . .

# Открываем порт (если нужно)
EXPOSE 3000

# Запускаем бота
CMD ["node", "bot.js"]