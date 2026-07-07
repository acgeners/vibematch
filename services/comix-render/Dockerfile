# Imagem oficial do Playwright: já traz Chromium + system deps na versão casada.
# A tag DEVE bater com a versão do pacote `playwright` no package.json (1.61.1),
# senão o revision do browser não confere.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app
ENV NODE_ENV=production
# Browsers já vêm na imagem base → não baixar de novo no npm install.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

ENV PORT=8790
EXPOSE 8790

CMD ["npm", "run", "start"]
