# Your own SearXNG metasearch (Google/Bing/DuckDuckGo/Brave/Startpage/Mojeek… in one) = unlimited free web search for the AI agent.
# Hosted free as a PRIVATE Hugging Face Docker Space (the app sends your HF token, nobody else can use it).
FROM searxng/searxng:latest
USER root
COPY settings.yml /etc/searxng/settings.yml
RUN chown -R 1000:1000 /etc/searxng /var/cache/searxng 2>/dev/null || true
ENV SEARXNG_PORT=7860 SEARXNG_BIND_ADDRESS=0.0.0.0 GRANIAN_PORT=7860 GRANIAN_HOST=0.0.0.0
USER 1000
EXPOSE 7860
