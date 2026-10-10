# Optional: for hosts that deploy containers (Koyeb, Fly.io, Railway, Cloud Run).
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY . .
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
