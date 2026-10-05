# Your own SearXNG = unlimited web search for FDE Job Finder (no per-search quota).
# Works on Hugging Face Spaces (free CPU), Render, Railway, Fly.io, any VM or your PC.
FROM searxng/searxng:latest
COPY settings.yml /etc/searxng/settings.yml
ENV SEARXNG_SETTINGS_PATH=/etc/searxng/settings.yml
EXPOSE 8080
