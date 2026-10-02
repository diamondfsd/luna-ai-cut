#!/bin/bash

REV=1.0.4

if test "`echo -e Test`" != "Test" 2>&1; then
  echo Please run this with zsh or bash.
  exit 1
fi

if test -x "`which tput`"; then
  ncolors=`tput colors`
  if test -n "$ncolors" && test $ncolors -ge 8; then
    BOLD="$(tput bold)"
    UNDERLINE="$(tput smul)"
    STANDOUT="$(tput smso)"
    NORMAL="$(tput sgr0)"
    BLACK="$(tput setaf 0)"
    RED="$(tput setaf 1)"
    GREEN="$(tput setaf 2)"
    YELLOW="$(tput setaf 3)"
    BLUE="$(tput setaf 4)"
    MAGENTA="$(tput setaf 5)"
    CYAN="$(tput setaf 6)"
    WHITE="$(tput setaf 7)"
  fi
fi

echo -e "${BOLD}**** libimobiledevice stack build script for msys2, revision $REV ****${NORMAL}"

if test -z "$MSYSTEM_CARCH"; then
  echo -e "${RED}Unsupported MSYS2 environment. Supported are MinGW64, MinGW32, and UCRT64.${NORMAL}"
  exit 1
fi 
case "$MINGW_PREFIX" in
"/mingw32")
  flavor=w64
  libcurl_flavor=mingw32
  libzip_flavor=mingw32
  ;;
"/mingw64")
  flavor=w64
  libcurl_flavor=mingw64
  libzip_flavor=mingw64
  ;;
"/ucrt64")
  flavor=w64-ucrt
  libcurl_flavor=ucrt64
  libzip_flavor=mingw64
  ;;
*)
  echo -e "${RED}Unsupported MSYS2 environment. Supported are MinGW64, MinGW32, and UCRT64.${NORMAL}"
  exit 1
  ;;
esac

echo -e "${CYAN}######## INSTALLING REQUIRED TOOLS AND DEPENDENCIES ########${NORMAL}"

PACKAGES="base-devel git mingw-$flavor-$MSYSTEM_CARCH-gcc make libtool autoconf automake-wrapper pkgconf mingw-$flavor-$MSYSTEM_CARCH-readline mingw-$flavor-$MSYSTEM_CARCH-openssl mingw-$flavor-$MSYSTEM_CARCH-libxml2 mingw-$flavor-$MSYSTEM_CARCH-bzip2 mingw-$flavor-$MSYSTEM_CARCH-xz"
pacman --needed --noconfirm -S $PACKAGES || exit 1

mkdir -p deps

OPENSSL_LIBS="$MINGW_PREFIX/lib/libssl.a $MINGW_PREFIX/lib/libcrypto.a -lws2_32 -lgdi32 -lcrypt32"
OPENSSL_CFLAGS="-I$MINGW_PREFIX/include"

READLINE_LIBS="$MINGW_PREFIX/lib/libreadline.a $MINGW_PREFIX/lib/libhistory.a $MINGW_PREFIX/lib/libtermcap.a"
READLINE_CFLAGS="-I$MINGW_PREFIX/include"

echo "Fetching pre-compiled libzip"
FILENAME="libzip-1.7.1-static.tar.bz2"
curl -o $FILENAME.b64 -Ls "https://gist.github.com/nikias/3da15d03120382f87b44029cd8495a02/raw/libzip-1.7.1_static_$MSYSTEM_CARCH-$libzip_flavor.tar.bz2"
base64 -d < $FILENAME.b64 > $FILENAME
tar -C deps -xjf $FILENAME
LIBZIP_CFLAGS="-I`pwd`/deps/include"
LIBZIP_LIBS="`pwd`/deps/lib/libzip.a $MINGW_PREFIX/lib/libbz2.a $MINGW_PREFIX/lib/liblzma.a $MINGW_PREFIX/lib/libz.a"
LIBZIP_VERSION="1.7.1"
echo "Fetching pre-compiled libcurl"
FILENAME="libcurl-8.10.1-static.tar.bz2"
curl -o $FILENAME.b64 -Ls "https://gist.github.com/nikias/19361dbe7692ff2fc8a01c9d7a107c4a/raw/libcurl-8.10.1-static-$MSYSTEM_CARCH-$libcurl_flavor.tar.bz2"
base64 -d < $FILENAME.b64 > $FILENAME
tar -C deps -xjf $FILENAME
LIBCURL_CFLAGS="-I`pwd`/deps/include -DCURL_STATICLIB"
LIBCURL_LIBS="`pwd`/deps/lib/libcurl.a $MINGW_PREFIX/lib/libzstd.a $MINGW_PREFIX/lib/libz.a $OPENSSL_LIBS -lws2_32 -lgdi32 -lcrypt32 -lwldap32 -lbcrypt -lucrt"
LIBCURL_VERSION="8.10.1"

CURDIR=`pwd`

#############################################################################
COMPONENTS="
  libplist:master \
  libimobiledevice-glue:master \
  libusbmuxd:master \
  libimobiledevice:master  \
  libirecovery:master \
  libtatsu:master \
  idevicerestore:master \
  libideviceactivation:master \
  ideviceinstaller:master \
"
# error helper function
function error_exit {
  echo "$1"
  exit 1
}

if test -z "$NO_CLONE"; then
echo
echo -e "${CYAN}######## UPDATING SOURCES ########${NORMAL}"
echo
for I in $COMPONENTS; do
  COMP=`echo $I |cut -d ":" -f 1`;
  CVER=`echo $I |cut -d ":" -f 2`;
  if test -d "$COMP/.git" && ! test -f "$COMP/.git/shallow"; then
    cd $COMP
    if test -z "`git branch |grep '$CVER'`"; then
      git checkout $CVER --quiet || error_exit "Failed to check out $CVER"
    fi
    if test "$CVER" != "master"; then
      echo "Updating $COMP (release $CVER)";
    else
      echo "Updating $COMP";
    fi
    git reset --hard --quiet
    git pull --quiet || error_exit "Failed to pull from git $COMP"
    cd "$CURDIR"
  else
    rm -rf $COMP
    if test "$CVER" != "master"; then
      echo "Cloning $COMP (release $CVER)";
      git clone -b $CVER https://github.com/libimobiledevice/$COMP 2>/dev/null || error_exit "Failed to clone $COMP"
    else
      echo "Cloning $COMP (master)";
      git clone https://github.com/libimobiledevice/$COMP 2>/dev/null || error_exit "Failed to clone $COMP"
    fi
  fi
done
fi

#############################################################################
echo
echo -e "${CYAN}######## STARTING BUILD ########${NORMAL}"
echo
#############################################################################

export PKG_CONFIG_PATH=/local/lib/pkgconfig

function error_out {
  echo -e "${RED}ERROR: ${STEP} failed for ${COMP}, check ${YELLOW}${LOGF}${RED} for details.${NORMAL}"
  exit 1
}

#############################################################################
COMP=libplist
echo -e "${BOLD}#### Building libplist ####${NORMAL}"
cd libplist
echo -e "[*] Configuring..."
STEP=configure
LOGF=$CURDIR/${COMP}_${STEP}.log
./autogen.sh --prefix="$PREFIX" --without-cython > "$LOGF" 2>&1 || error_out
echo -e "[*] Building..."
STEP=build
LOGF=$CURDIR/${COMP}_${STEP}.log
make clean > /dev/null 2>&1
make V=1 > "$LOGF" 2>&1 || error_out
echo -e "[*] Installing..."
STEP=install
LOGF=$CURDIR/${COMP}_${STEP}.log
make install > "$LOGF" 2>&1 || error_out
LIBPLIST_CFLAGS="-I$PREFIX/include"
LIBPLIST_LIBS="-L$PREFIX/lib -lplist-2.0"
LIBPLIST_VERSION=`cat src/libplist-2.0.pc |grep Version: |cut -d " " -f 2`
cd "$CURDIR"

#############################################################################
COMP=libimobiledevice-glue
echo -e "${BOLD}#### Building libimobiledevice-glue ####${NORMAL}"
cd libimobiledevice-glue
echo -e "[*] Configuring..."
STEP=configure
LOGF=$CURDIR/${COMP}_${STEP}.log
./autogen.sh --prefix="$PREFIX" libplist_CFLAGS="$LIBPLIST_CFLAGS" libplist_LIBS="$LIBPLIST_LIBS" libplist_VERSION="$LIBPLIST_VERSION" > "$LOGF" 2>&1 || error_out
echo -e "[*] Building..."
STEP=build
LOGF=$CURDIR/${COMP}_${STEP}.log
make clean > /dev/null 2>&1
make V=1 > "$LOGF" 2>&1 || error_out
echo -e "[*] Installing..."
STEP=install
LOGF=$CURDIR/${COMP}_${STEP}.log
make install > "$LOGF" 2>&1 || error_out
LIMD_GLUE_CFLAGS="-I$PREFIX/include"
LIMD_GLUE_LIBS="-L$PREFIX/lib -limobiledevice-glue-1.0"
LIMD_GLUE_VERSION=`cat src/libimobiledevice-glue-1.0.pc |grep Version: |cut -d " " -f 2`
cd "$CURDIR"

#############################################################################
COMP=libtatsu
echo -e "${BOLD}#### Building libtatsu ####${NORMAL}"
cd libtatsu
echo -e "[*] Configuring..."
STEP=configure
LOGF=$CURDIR/${COMP}_${STEP}.log
./autogen.sh --prefix="$PREFIX" \
  libplist_CFLAGS="$LIBPLIST_CFLAGS" libplist_LIBS="$LIBPLIST_LIBS" libplist_VERSION="$LIBPLIST_VERSION" \
  libcurl_CFLAGS="$LIBCURL_CFLAGS" libcurl_LIBS="$LIBCURL_LIBS" libcurl_VERSION="$LIBCURL_VERSION" > "$LOGF" 2>&1 || error_out
echo -e "[*] Building..."
STEP=build
LOGF=$CURDIR/${COMP}_${STEP}.log
make clean > /dev/null 2>&1
make V=1 > "$LOGF" 2>&1 || error_out
echo -e "[*] Installing..."
STEP=install
LOGF=$CURDIR/${COMP}_${STEP}.log
make install > "$LOGF" 2>&1 || error_out
LIBTATSU_CFLAGS="-I$PREFIX/include"
LIBTATSU_LIBS="-L$PREFIX/lib -ltatsu"
LIBTATSU_VERSION=`cat src/libtatsu-1.0.pc |grep Version: |cut -d " " -f 2`
cd "$CURDIR"

#############################################################################
COMP=libusbmuxd
echo -e "${BOLD}#### Building libusbmuxd ####${NORMAL}"
cd libusbmuxd
echo -e "[*] Configuring..."
STEP=configure
LOGF=$CURDIR/${COMP}_${STEP}.log
./autogen.sh --prefix="$PREFIX" libplist_CFLAGS="$LIBPLIST_CFLAGS" libplist_LIBS="$LIBPLIST_LIBS" libplist_VERSION="$LIBPLIST_VERSION" limd_glue_CFLAGS="$LIMD_GLUE_CFLAGS" limd_glue_LIBS="$LIMD_GLUE_LIBS" limd_glue_VERSION="$LIMD_GLUE_VERSION" > "$LOGF" 2>&1 || error_out
echo -e "[*] Building..."
STEP=build
LOGF=$CURDIR/${COMP}_${STEP}.log
make clean > /dev/null 2>&1
make V=1 > "$LOGF" 2>&1 || error_out
echo -e "[*] Installing..."
STEP=install
LOGF=$CURDIR/${COMP}_${STEP}.log
make install > "$LOGF" 2>&1 || error_out
LIBUSBMUXD_CFLAGS="-I$PREFIX/include"
LIBUSBMUXD_LIBS="-L$PREFIX/lib -lusbmuxd-2.0"
LIBUSBMUXD_VERSION=`cat src/libusbmuxd-2.0.pc |grep Version: |cut -d " " -f 2`
cd "$CURDIR"

#############################################################################
COMP=libimobiledevice
echo -e "${BOLD}#### Building libimobiledevice ####${NORMAL}"
cd libimobiledevice
echo -e "[*] Configuring..."
STEP=configure
LOGF=$CURDIR/${COMP}_${STEP}.log
./autogen.sh --prefix="$PREFIX" --enable-debug --without-cython \
  openssl_CFLAGS="$OPENSSL_CFLAGS" openssl_LIBS="$OPENSSL_LIBS" \
  libplist_CFLAGS="$LIBPLIST_CFLAGS" libplist_LIBS="$LIBPLIST_LIBS" libplist_VERSION="$LIBPLIST_VERSION" \
  libusbmuxd_CFLAGS="$LIBUSBMUXD_CFLAGS" libusbmuxd_LIBS="$LIBUSBMUXD_LIBS" libusbmuxd_VERSION="$LIBUSBMUXD_VERSION" \
  limd_glue_CFLAGS="$LIMD_GLUE_CFLAGS" limd_glue_LIBS="$LIMD_GLUE_LIBS" limd_glue_VERSION="$LIMD_GLUE_VERSION" \
  libtatsu_CFLAGS="$LIBTATSU_CFLAGS" libtatsu_LIBS="$LIBTATSU_LIBS" libtatsu_VERSION="$LIBTATSU_VERSION" \
  readline_CFLAGS="$READLINE_CFLAGS" readline_LIBS="$READLINE_LIBS" readline_VERSION="$READLINE_VERSION" \
  > "$LOGF" 2>&1 || error_out
echo -e "[*] Building..."
STEP=build
LOGF=$CURDIR/${COMP}_${STEP}.log
make clean > /dev/null 2>&1
make V=1 > "$LOGF" 2>&1 || error_out
echo -e "[*] Installing..."
STEP=install
LOGF=$CURDIR/${COMP}_${STEP}.log
make install > "$LOGF" 2>&1 || error_out
LIMD_CFLAGS="-I$PREFIX/include"
LIMD_LIBS="-L$PREFIX/lib -limobiledevice-1.0 -lplist-2.0"
LIMD_VERSION=`cat src/libimobiledevice-1.0.pc |grep Version: |cut -d " " -f 2`
cd "$CURDIR"

#############################################################################
COMP=libirecovery
echo -e "${BOLD}#### Building libirecovery ####${NORMAL}"
cd libirecovery
echo -e "[*] Configuring..."
STEP=configure
LOGF=$CURDIR/${COMP}_${STEP}.log
./autogen.sh --prefix="$PREFIX" limd_glue_CFLAGS="$LIMD_GLUE_CFLAGS" limd_glue_LIBS="$LIMD_GLUE_LIBS" limd_glue_VERSION="$LIMD_GLUE_VERSION" > "$LOGF" 2>&1 || error_out
echo -e "[*] Building..."
STEP=build
LOGF=$CURDIR/${COMP}_${STEP}.log
make clean > /dev/null 2>&1
make V=1 > "$LOGF" 2>&1 || error_out
echo -e "[*] Installing..."
STEP=install
LOGF=$CURDIR/${COMP}_${STEP}.log
make install > "$LOGF" 2>&1 || error_out
IRECV_CFLAGS="-I$PREFIX/include"
IRECV_LIBS="-L$PREFIX/lib -lirecovery-1.0"
IRECV_VERSION=`cat src/libirecovery-1.0.pc |grep Version: |cut -d " " -f 2`
cd "$CURDIR"

#############################################################################
COMP=idevicerestore
echo -e "${BOLD}#### Building idevicerestore ####${NORMAL}"
cd idevicerestore
echo -e "[*] Configuring..."
STEP=configure
LOGF=$CURDIR/${COMP}_${STEP}.log
./autogen.sh --prefix="$PREFIX" \
  openssl_CFLAGS="$OPENSSL_CFLAGS" openssl_LIBS="$OPENSSL_LIBS" \
  libcurl_CFLAGS="$LIBCURL_CFLAGS" libcurl_LIBS="$LIBCURL_LIBS" libcurl_VERSION="$LIBCURL_VERSION" \
  libzip_CFLAGS="$LIBZIP_CFLAGS" libzip_LIBS="$LIBZIP_LIBS" libzip_VERSION="$LIBZIP_VERSION" \
  zlib_CFLAGS="-I$SDKDIR/usr/include" zlib_LIBS="-lz" zlib_VERSION="1.2" \
  libimobiledevice_CFLAGS="$LIMD_CFLAGS" libimobiledevice_LIBS="$LIMD_LIBS" libimobiledevice_VERSION="$LIMD_VERSION" \
  libusbmuxd_CFLAGS="$LIBUSBMUXD_CFLAGS" libusbmuxd_LIBS="$LIBUSBMUXD_LIBS" libusbmuxd_VERSION="$LIBUSBMUXD_VERSION" \
  libirecovery_CFLAGS="$IRECV_CFLAGS" libirecovery_LIBS="$IRECV_LIBS" libirecovery_VERSION="$IRECV_VERSION" \
  libplist_CFLAGS="$LIBPLIST_CFLAGS" libplist_LIBS="$LIBPLIST_LIBS" libplist_VERSION="$LIBPLIST_VERSION" \
  limd_glue_CFLAGS="$LIMD_GLUE_CFLAGS" limd_glue_LIBS="$LIMD_GLUE_LIBS" limd_glue_VERSION="$LIMD_GLUE_VERSION" \
  libtatsu_CFLAGS="$LIBTATSU_CFLAGS" libtatsu_LIBS="$LIBTATSU_LIBS" libtatsu_VERSION="$LIBTATSU_VERSION" \
  > "$LOGF" 2>&1 || error_out
echo -e "[*] Building..."
STEP=build
LOGF=$CURDIR/${COMP}_${STEP}.log
make clean > /dev/null 2>&1
make V=1 > "$LOGF" 2>&1 || error_out
echo -e "[*] Installing..."
STEP=install
LOGF=$CURDIR/${COMP}_${STEP}.log
make install > "$LOGF" 2>&1 || error_out
cd "$CURDIR"

#############################################################################
COMP=libideviceactivation
echo -e "${BOLD}#### Building libideviceactivation ####${NORMAL}"
cd libideviceactivation
echo -e "[*] Configuring..."
STEP=configure
LOGF=$CURDIR/${COMP}_${STEP}.log
./autogen.sh --prefix="$PREFIX" \
  libcurl_CFLAGS="$LIBCURL_CFLAGS" libcurl_LIBS="$LIBCURL_LIBS" libcurl_VERSION="$LIBCURL_VERSION" \
  libxml2_CFLAGS="-I$MINGW_PREFIX/include/libxml2 -DLIBXML_STATIC" libxml2_LIBS="$MINGW_PREFIX/lib/libxml2.a $MINGW_PREFIX/lib/libiconv.a $MINGW_PREFIX/lib/libz.a $MINGW_PREFIX/lib/liblzma.a" \
  libimobiledevice_CFLAGS="$LIMD_CFLAGS" libimobiledevice_LIBS="$LIMD_LIBS" libimobiledevice_VERSION="$LIMD_VERSION" \
  libplist_CFLAGS="$LIBPLIST_CFLAGS" libplist_LIBS="$LIBPLIST_LIBS" libplist_VERSION="$LIBPLIST_VERSION" \
  > "$LOGF" 2>&1 || error_out
echo -e "[*] Building..."
STEP=build
LOGF=$CURDIR/${COMP}_${STEP}.log
make clean > /dev/null 2>&1
make V=1 > "$LOGF" 2>&1 || error_out
echo -e "[*] Installing..."
STEP=install
LOGF=$CURDIR/${COMP}_${STEP}.log
make install > "$LOGF" 2>&1 || error_out
cd "$CURDIR"

#############################################################################
COMP=ideviceinstaller
echo -e "${BOLD}#### Building ideviceinstaller ####${NORMAL}"
cd ideviceinstaller
echo -e "[*] Configuring..."
STEP=configure
LOGF=$CURDIR/${COMP}_${STEP}.log
./autogen.sh --prefix="$PREFIX" \
  libzip_CFLAGS="$LIBZIP_CFLAGS" libzip_LIBS="$LIBZIP_LIBS" libzip_VERSION="$LIBZIP_VERSION" \
  libimobiledevice_CFLAGS="$LIMD_CFLAGS" libimobiledevice_LIBS="$LIMD_LIBS" libimobiledevice_VERSION="$LIMD_VERSION" \
  libplist_CFLAGS="$LIBPLIST_CFLAGS" libplist_LIBS="$LIBPLIST_LIBS" libplist_VERSION="$LIBPLIST_VERSION" \
  > "$LOGF" 2>&1 || error_out
echo -e "[*] Building..."
STEP=build
LOGF=$CURDIR/${COMP}_${STEP}.log
make clean > /dev/null 2>&1
make V=1 > "$LOGF" 2>&1 || error_out
echo -e "[*] Installing..."
STEP=install
LOGF=$CURDIR/${COMP}_${STEP}.log
make install > "$LOGF" 2>&1 || error_out
cd "$CURDIR"

#############################################################################
echo
echo -e "${CYAN}######## BUILD COMPLETE ########${NORMAL}"
echo
echo -e "${BOLD}If you like this script and my work on libimobiledevice, please
consider becoming a patron at ${YELLOW}https://patreon.com/nikias${NORMAL}"
echo -e "${BOLD}or a GitHub sponsor: ${YELLOW}https://github.com/sponsors/nikias${NORMAL}"
echo -e "${BOLD}or send some love via PayPal: ${YELLOW}https://www.paypal.me/NikiasBassen${NORMAL}"
echo -e "${BOLD}Thanks ${RED}<3${NORMAL}"
echo
#############################################################################