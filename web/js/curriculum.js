// 산업경영공학과 커리큘럼 (학과 이수 체계도를 옮김). 둘러보기 화면이 이 표로 학년·학기를 그린다
// codes: 플랫폼 과목 코드(course.code). 같은 과목의 여러 학기 문제 세트를 모두 잇는다. 비어 있으면 "준비 중"
// pre: 먼저 들으면 좋은 과목 id (체계도의 화살표)
export const KINDS = { base: "전공기초", req: "전공필수", opt: "전공선택", ge: "교양" };

export const CURRICULUM = [
  { year: 1, terms: [
    [
      { id: "calc", name: "미분적분학", kind: "base" },
      { id: "ieintro", name: "산업경영공학의 이해", kind: "base" },
    ],
    [
      { id: "phys", name: "일반물리", kind: "base" },
      { id: "prog", name: "기초프로그래밍", kind: "base" },
    ],
  ] },
  { year: 2, terms: [
    [
      { id: "em1", name: "공학수학 1", kind: "base" },
      { id: "ds1", name: "데이터사이언스 1", kind: "opt", pre: ["prog"] },
      { id: "pdms", name: "제품개발및제조시스템", kind: "opt" },
      { id: "expstat", name: "실험통계학", kind: "base" },
      { id: "db", name: "데이터베이스", kind: "opt" },
      { id: "econ", name: "경제성공학", kind: "opt" },
      { id: "ergo", name: "인간공학", kind: "opt" },
    ],
    [
      { id: "em2", name: "공학수학 2", kind: "base", codes: ["LA2"] },
      { id: "ds2", name: "데이터사이언스 2", kind: "opt", pre: ["ds1"] },
      { id: "pom", name: "생산경영론", kind: "opt", codes: ["IE216"] },
      { id: "appstat", name: "응용통계학", kind: "base", codes: ["IE208"], pre: ["expstat"] },
      { id: "mis", name: "경영정보시스템", kind: "opt", codes: ["MIS"] },
      { id: "htmkt", name: "하이테크마케팅", kind: "opt" },
    ],
  ] },
  { year: 3, terms: [
    [
      { id: "ms1", name: "경영과학 1", kind: "req" },
      { id: "dm1", name: "데이터마이닝 1", kind: "opt", pre: ["ds2"] },
      { id: "scm", name: "공급사슬관리", kind: "opt" },
      { id: "qe", name: "품질공학", kind: "opt", pre: ["appstat"] },
      { id: "fe", name: "금융공학", kind: "opt" },
      { id: "mot", name: "기술경영", kind: "opt" },
    ],
    [
      { id: "ms2", name: "경영과학 2", kind: "opt" },
      { id: "dm2", name: "데이터마이닝 2", kind: "opt", pre: ["dm1"] },
      { id: "isdd", name: "정보시스템설계및개발", kind: "opt", pre: ["prog"] },
      { id: "logi", name: "물류관리", kind: "opt" },
      { id: "iot", name: "사물인터넷", kind: "opt" },
      { id: "ai", name: "인공지능", kind: "opt" },
      { id: "motda", name: "기술경영데이터분석", kind: "opt" },
      { id: "hci", name: "인간컴퓨터인터페이스", kind: "opt", pre: ["ergo"] },
    ],
  ] },
  { year: 4, terms: [
    [
      { id: "sds", name: "서비스데이터사이언스", kind: "opt" },
      { id: "cad", name: "CAD/CAM", kind: "opt" },
      { id: "sim", name: "컴퓨터시뮬레이션", kind: "opt", pre: ["appstat"] },
      { id: "ml", name: "머신러닝", kind: "opt" },
      { id: "beda", name: "경영경제데이터분석", kind: "opt" },
      { id: "cap1", name: "창의적종합설계 1", kind: "req" },
    ],
    [
      { id: "algo", name: "산업경영알고리즘", kind: "opt" },
      { id: "tcomm", name: "기술사업화", kind: "opt" },
      { id: "safety", name: "작업및안전관리", kind: "opt" },
      { id: "cap2", name: "창의적종합설계 2", kind: "req", pre: ["appstat"] },
    ],
  ] },
];
