# 우클릭 로컬 번역

Brave Origin과 네이버 웨일에서 선택한 텍스트나 현재 페이지를 한국어로 번역합니다. 두 브라우저가 Vulkan GPU에서 실행되는 PFN의 **PLaMo 3 Translate 0.8B GGUF Q4_K_M**을 공유합니다.

## 실행 환경

- Windows x64와 Vulkan을 지원하는 GPU 및 드라이버
- Brave Origin 또는 네이버 웨일
- 첫 빌드에 필요한 인터넷 연결과 약 610MB의 다운로드 용량

## 설치

1. 저장소를 클론하거나 GitHub의 **Code → Download ZIP**으로 받은 뒤 쓰기 가능한 폴더에 풉니다. `BUILD.cmd`를 더블클릭하면 llama.cpp Vulkan 배포본과 번역 모델을 내려받고 SHA-256을 확인한 뒤 `extension` 폴더를 생성합니다.
2. Brave Origin의 `brave://extensions`와 웨일의 `whale://extensions`에서 각각 개발자 모드를 켭니다. **압축해제된 확장 프로그램 로드** 또는 **압축 해제된 확장앱 설치**를 눌러 같은 `extension` 폴더를 선택합니다.
3. `START.cmd`를 실행합니다. Vulkan을 지원하는 GPU 드라이버가 필요합니다. 목록에서 사용 가능한 메모리가 가장 많은 GPU를 자동으로 고르며, 예를 들어 `START.cmd -Device Vulkan1`로 직접 지정할 수 있습니다. 엔진은 이 PC의 `127.0.0.1:39781`에만 연결됩니다. 초기 파일 다운로드 이후 인터넷 없이 번역할 수 있습니다. 종료할 때는 `STOP.cmd`를 실행합니다.

## 사용

- 텍스트를 드래그한 뒤 우클릭하고 **선택한 텍스트를 한국어로 번역**을 선택합니다. 웹페이지에서 **페이지를 한국어로 번역**을 선택하거나 확장 아이콘을 클릭하면 현재 페이지를 번역합니다.
- **페이지 내 번역**이 기본입니다. 페이지의 링크와 HTML 구조를 유지하면서 보이는 텍스트를 바꾸며, 화면 상단의 **원문으로 복원**으로 되돌릴 수 있습니다. 문서에 로드된 텍스트 처음 약 4만 자까지 처리합니다.
- 확장 아이콘 우클릭 또는 확장 관리의 **옵션**에서 **페이지 내 번역**과 **번역 시 새 탭 열기**를 전환합니다. 각 브라우저에 설정이 따로 저장됩니다. 새 탭에서는 구간별 **원문 보기**와 **번역 복사**를 사용할 수 있습니다.

## 기존 CPU 버전 업데이트 또는 다른 PC에서 설치

기존 CPU 엔진 창을 닫고, ZIP의 파일을 기존 폴더에 덮어씁니다. `BUILD.cmd`를 실행한 뒤 두 브라우저의 확장 관리 화면에서 이 확장을 새로고침하고 `START.cmd`를 실행합니다. 다른 PC에서는 ZIP을 옮겨 설치 단계를 처음부터 실행하세요.

## 동작 방식

확장은 우클릭 메뉴나 아이콘에서 받은 텍스트를 짧은 구간으로 나눠 `127.0.0.1:39781`의 로컬 번역 엔진에 전달합니다. 엔진은 빌드 시 생성한 로컬 연결 키로 요청을 확인하고, 한국어를 대상으로 지정한 PLaMo 전용 프롬프트로 번역을 실행합니다. 브라우저에 로드된 일반 웹페이지의 텍스트가 대상입니다.

- `src/`는 Manifest V3 확장 소스입니다.
- `BUILD.cmd`는 공식 배포 파일을 확인하고 브라우저에 로드할 확장 폴더를 만듭니다.
- `START.cmd`와 `STOP.cmd`는 이 프로젝트의 로컬 엔진을 제어합니다.

## 문제 해결

- **엔진에 연결할 수 없습니다**가 표시되면 `START.cmd`로 이 폴더의 엔진을 실행합니다. 이전 CPU 버전이 같은 포트에서 실행 중이면 해당 창을 먼저 닫습니다.
- Vulkan 장치를 찾지 못하면 GPU 드라이버의 Vulkan 지원을 확인합니다.
- 확장을 업데이트한 뒤 예전 메뉴가 보이면 브라우저의 확장 관리 화면에서 이 확장을 새로고침합니다.

## 검증 및 변경 이력

RTX 5070 Ti에서 GPU 실행을 확인했습니다. Brave Origin과 웨일의 별도 프로필에서 확장 동작을 호출해 두 표시 방식, 선택 영역 번역, 링크 유지 및 원문 복원을 검증했습니다. 버전별 변경 사항은 [변경 이력](CHANGELOG.md)에 있습니다.

## 출처 및 외부 구성 요소

- [Chrome 우클릭 메뉴 API](https://developer.chrome.com/docs/extensions/reference/api/contextMenus)
- [웨일 확장앱 설치 문서](https://developers.whale.naver.com/tutorials/debugging/)
- [PFN PLaMo 3 Translate 0.8B 공식 GGUF 및 모델 라이선스](https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF)
- [llama.cpp Windows 배포본](https://github.com/ggml-org/llama.cpp/releases/tag/b12246)
