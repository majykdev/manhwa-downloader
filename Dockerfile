FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY public ./public

EXPOSE 3000

CMD ["npm", "start"]
