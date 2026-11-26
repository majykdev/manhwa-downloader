FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
RUN npx playwright install --with-deps chromium

COPY src ./src
COPY public ./public

EXPOSE 3001

CMD ["npm", "start"]
