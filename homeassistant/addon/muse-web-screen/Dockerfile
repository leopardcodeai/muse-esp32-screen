ARG BUILD_FROM=nginx:1.31.2-alpine
FROM ${BUILD_FROM}

RUN apk add --no-cache jq

COPY run.sh /run.sh
COPY nginx.conf.template /etc/nginx/templates/muse-web.conf.template
RUN chmod +x /run.sh

ENTRYPOINT ["/run.sh"]
