#!/usr/bin/env python

# import sys
# sys.path.append('../ai2')

import requests
from urllib.parse import quote
from unix_socket_adapter import UnixHTTPAdapter

session = requests.Session()
# session.mount("http+unix://", UnixHTTPAdapter())

socket_path = "/tmp/my-socket.sock"

# url = f"http+unix://{quote(socket_path, safe='')}/version"
# r = session.get(url)
# print(r)
# print(r.content)

# Or bind the adapter to a fixed socket:
a = UnixHTTPAdapter(socket_path)
session.mount("http://", a) # UnixHTTPAdapter(socket_path))
session.mount("https://", a) # UnixHTTPAdapter(socket_path))
r = session.get("https://example.com/version/path", headers={'accept': 'application/json'})
print(r)
print(r.content)
