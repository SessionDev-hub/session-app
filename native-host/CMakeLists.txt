cmake_minimum_required(VERSION 3.22)
project(PSHost VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# JUCE 8.0.11+ supports Visual Studio 2026 (MSVC v145) and ships the VST3 SDK 3.8,
# so plugins built with newer SDKs load. Override with -DPS_JUCE_TAG=... if needed,
# or point at a local JUCE checkout with -DFETCHCONTENT_SOURCE_DIR_JUCE=C:/path/to/JUCE.
set(PS_JUCE_TAG "8.0.16-security" CACHE STRING "JUCE git tag to build against")

include(FetchContent)
FetchContent_Declare(JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG ${PS_JUCE_TAG}
  GIT_SHALLOW ON)
FetchContent_MakeAvailable(JUCE)

if(MSVC)
  # /MP: parallel compile; /bigobj: JUCE's VST3 hosting code exceeds the default section limit;
  # /utf-8 and /Zc:__cplusplus keep newer MSVC toolsets (v143, v145) consistent with the JUCE/VST3 headers.
  add_compile_options(/MP /bigobj /utf-8 /Zc:__cplusplus)
  # Static runtime: ps-host.exe runs without installing the matching Visual C++ Redistributable.
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

juce_add_gui_app(PSHost
  PRODUCT_NAME "ps-host"
  COMPANY_NAME "Private Studio")

target_sources(PSHost PRIVATE src/Main.cpp)

target_compile_definitions(PSHost PRIVATE
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
  JUCE_PLUGINHOST_VST3=1
  JUCE_PLUGINHOST_VST=0
  JUCE_PLUGINHOST_AU=0
  JUCE_PLUGINHOST_LADSPA=0
  JUCE_MODAL_LOOPS_PERMITTED=0
  JUCE_APPLICATION_NAME_STRING="ps-host"
  JUCE_APPLICATION_VERSION_STRING="0.1.0")

target_link_libraries(PSHost PRIVATE
  juce::juce_core
  juce::juce_events
  juce::juce_data_structures
  juce::juce_audio_basics
  juce::juce_audio_processors
  juce::juce_gui_basics
  juce::juce_recommended_config_flags)

# Put the finished program where Private Studio looks for it: <app>/bin/ps-host.exe
add_custom_command(TARGET PSHost POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory "${CMAKE_CURRENT_SOURCE_DIR}/../bin"
  COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE:PSHost>" "${CMAKE_CURRENT_SOURCE_DIR}/../bin/ps-host.exe"
  COMMENT "Copying ps-host.exe into the app's bin folder")
