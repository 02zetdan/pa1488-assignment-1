FROM node:26-alpine
EXPOSE 3000
WORKDIR /app
COPY . .
RUN npm install --omit=dev
ARG APP_VERSION=1.0
ENV APP_VERSION=$APP_VERSION
ENV DEBUG='qfapp:*'
ENTRYPOINT ["node", "src/index.js"]
