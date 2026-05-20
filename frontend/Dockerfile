# Dev-server image (Vite over HTTPS). For production you'd `vite build` and
# serve the static dist/ behind nginx with a real cert.
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]
