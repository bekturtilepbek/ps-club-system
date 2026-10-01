# postgres:16-alpine (pg_dump matching the server) plus rclone for the off-machine copy.
FROM postgres:16-alpine
RUN apk add --no-cache rclone
