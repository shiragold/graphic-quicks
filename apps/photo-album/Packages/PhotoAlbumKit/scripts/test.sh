#!/bin/sh
# Runs `swift test` for PhotoAlbumKit with Xcode or with only the Command Line Tools.
#
# Swift Testing ships inside Xcode's platform folder. With only the Command Line Tools
# selected, SwiftPM does not find its `Testing` module on its own, so its generated test
# runner builds without Swift Testing and runs nothing. Pass the framework folder to every
# target in that case. The CLT's `_Testing_Foundation` overlay ships without a module, so
# cross-import overlays are turned off too. With Xcode selected this is plain `swift test`.
set -eu
cd "$(dirname "$0")/.."

developer_dir="${DEVELOPER_DIR:-$(xcode-select -p)}"
frameworks=/Library/Developer/CommandLineTools/Library/Developer/Frameworks

case "$developer_dir" in
  *CommandLineTools*)
    exec swift test \
      -Xswiftc -F -Xswiftc "$frameworks" \
      -Xswiftc -Xfrontend -Xswiftc -disable-cross-import-overlays \
      -Xlinker -rpath -Xlinker "$frameworks" \
      "$@"
    ;;
  *)
    exec swift test "$@"
    ;;
esac
