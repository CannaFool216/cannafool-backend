# Fix react-native-safe-area-context Windows CMake path bug
$cmakeFile = "C:\cf54\node_modules\react-native-safe-area-context\android\build\generated\source\codegen\jni\CMakeLists.txt"
$cxxCache = "C:\cf54\android\app\.cxx"

if (Test-Path $cmakeFile) {
    $content = Get-Content $cmakeFile -Raw
    $oldLine = "file(GLOB react_codegen_SRCS CONFIGURE_DEPENDS *.cpp react/renderer/components/safeareacontext/*.cpp)"
    if ($content -match [regex]::Escape($oldLine)) {
        $newLines = "file(GLOB react_codegen_SRCS_ABS CONFIGURE_DEPENDS *.cpp react/renderer/components/safeareacontext/*.cpp)`n"
        $newLines += "set(react_codegen_SRCS `"`")`n"
        $newLines += "foreach(_f `${react_codegen_SRCS_ABS})`n"
        $newLines += "  file(RELATIVE_PATH _f_rel `"`${CMAKE_CURRENT_SOURCE_DIR}`" `"`${_f}`")`n"
        $newLines += "  list(APPEND react_codegen_SRCS `"`${_f_rel}`")`n"
        $newLines += "endforeach()"
        $patched = $content -replace [regex]::Escape($oldLine), $newLines
        Set-Content -Path $cmakeFile -Value $patched -NoNewline
        Write-Host "Patched CMakeLists.txt successfully" -ForegroundColor Green
    } elseif ($content -match "react_codegen_SRCS_ABS") {
        Write-Host "Already patched" -ForegroundColor Cyan
    } else {
        Write-Host "Pattern not found - file may have changed" -ForegroundColor Yellow
    }
} else {
    Write-Host "File not found: $cmakeFile" -ForegroundColor Red
}

if (Test-Path $cxxCache) {
    Remove-Item -Recurse -Force $cxxCache
    Write-Host "Cleared .cxx cache" -ForegroundColor Green
}

Write-Host "Done. Now run: npx expo run:android"
