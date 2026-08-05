cmake_minimum_required(VERSION 3.16)
project(luna-funasr-worker C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_ACCELERATE OFF CACHE BOOL "" FORCE)
set(GGML_BLAS OFF CACHE BOOL "" FORCE)
set(GGML_METAL OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_CURL OFF CACHE BOOL "" FORCE)

include(FetchContent)
if(POLICY CMP0169)
  cmake_policy(SET CMP0169 OLD)
endif()
FetchContent_Declare(
  llama
  GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
  GIT_TAG 8086439a4cea94c71a5dfb8fe4ad1546aebd640f
)
FetchContent_GetProperties(llama)
if(NOT llama_POPULATED)
  FetchContent_Populate(llama)
  # The worker only links ggml. Keep llama's full model library out of the
  # default build so packaging does not compile every models/*.cpp source.
  add_subdirectory(${llama_SOURCE_DIR} ${llama_BINARY_DIR} EXCLUDE_FROM_ALL)
endif()

find_package(Threads REQUIRED)
add_executable(luna-asr-worker luna-asr-worker.cpp)
target_include_directories(luna-asr-worker PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(luna-asr-worker PRIVATE ggml Threads::Threads)
if(MSVC)
  target_compile_definitions(luna-asr-worker PRIVATE NOMINMAX _USE_MATH_DEFINES)
  target_compile_options(luna-asr-worker PRIVATE /utf-8)
endif()
