# Get-ChildItem *.jpg | ForEach-Object { ffmpeg -y -i $_.FullName -q:v 4 "tmp.jpg"; Move-Item -Force "tmp.jpg" $_.FullName }
