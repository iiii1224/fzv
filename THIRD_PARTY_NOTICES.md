# Third-party notices

## fzf

`src/client/search.ts` adapts the FuzzyMatchV2 approach from fzf, via the original
project file viewer in `paper/tex/serve_viewer.py` supplied by the project owner.
The implementation is a TypeScript port of that viewer's JavaScript scorer;
it is not the fzf binary or an exact compatibility implementation.

Upstream: https://github.com/junegunn/fzf
Algorithm: https://github.com/junegunn/fzf/blob/master/src/algo/algo.go
License: https://github.com/junegunn/fzf/blob/master/LICENSE

The MIT License (MIT)

Copyright (c) 2013-2026 Junegunn Choi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
