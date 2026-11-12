FROM node:26-alpine
WORKDIR /app
COPY . .
RUN npm install --omit=dev
ARG APP_VERSION=1.0
ENV APP_VERSION=$APP_VERSION
ENV DEBUG='qfworker:*'
ENTRYPOINT ["node", "src/index.js"]
