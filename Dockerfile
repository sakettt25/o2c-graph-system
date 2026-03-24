FROM python:3.11-slim
WORKDIR /app
COPY server.py .
COPY scripts/ scripts/
COPY static/ static/
COPY data/ data/
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:3000/api/summary')" || exit 1
CMD ["python3", "server.py"]
