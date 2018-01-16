FROM node:8
WORKDIR /app
RUN apt-get install -y libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev build-essential g++
COPY package.json .
RUN yarn install
COPY . .
CMD ['yarn','start']