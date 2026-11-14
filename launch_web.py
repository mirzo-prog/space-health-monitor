"""Run the browser version without installing third-party packages."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser


def main():
    parser = argparse.ArgumentParser(description='Space Health Monitor — веб-симуляция')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent / 'web' / 'dist'
    handler = partial(SimpleHTTPRequestHandler, directory=str(root))
    try:
        server = ThreadingHTTPServer((args.host, args.port), handler)
    except PermissionError:
        offline = Path(__file__).resolve().parent / 'Space-Health.html'
        print('Среда запрещает запуск сетевого сервера.', flush=True)
        print(f'Откройте готовую симуляцию без сервера: {offline}', flush=True)
        if not args.no_browser:
            webbrowser.open(offline.as_uri())
        return
    except OSError as exc:
        parser.exit(1, f'Не удалось запустить сервер: {exc}. Попробуйте --port 8081.\n')
    with server:
        url = f'http://{args.host}:{server.server_port}'
        print(f'Space Health Monitor: {url}', flush=True)
        print('Для остановки нажмите Ctrl+C.', flush=True)
        if not args.no_browser:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
