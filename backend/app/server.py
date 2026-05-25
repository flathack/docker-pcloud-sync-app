import os


def build_uvicorn_options() -> dict[str, object]:
    certfile = os.getenv("SSL_CERTFILE", "").strip()
    keyfile = os.getenv("SSL_KEYFILE", "").strip()
    if bool(certfile) != bool(keyfile):
        raise RuntimeError("SSL_CERTFILE and SSL_KEYFILE must be set together.")

    options: dict[str, object] = {
        "app": "app.main:app",
        "app_dir": "/app/backend",
        "host": os.getenv("APP_HOST", "0.0.0.0"),
        "port": int(os.getenv("APP_PORT", "8000")),
    }
    if certfile and keyfile:
        options["ssl_certfile"] = certfile
        options["ssl_keyfile"] = keyfile
    return options


def main() -> None:
    import uvicorn

    uvicorn.run(**build_uvicorn_options())


if __name__ == "__main__":
    main()
