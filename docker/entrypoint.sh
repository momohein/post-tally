#!/bin/sh
set -e
# Bring the database schema up to date, then start the server.
prisma migrate deploy --schema ./prisma/schema.prisma
exec node server.js
