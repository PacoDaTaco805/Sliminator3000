FROM oven/bun:latest

WORKDIR /app

COPY package.json ./

COPY bun.lock ./

RUN bun install --production

COPY build/ ./build
COPY src/ ./src
COPY configs/ ./configs

CMD ["bun", "run", "build/index.js"]
