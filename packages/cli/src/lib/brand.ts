import pc from "picocolors";

export const OWO_ASCII = `
  ${pc.dim("░░███░░")} ${pc.yellow("░░░    ░░░")} ${pc.dim("░░███░░")}      
  ${pc.dim("░█   █░")} ${pc.yellow("░█░    ░█░")}  ${pc.dim("░█   █░")}     
  ${pc.dim("░█   █░")} ${pc.yellow("░█░ █░ ░█░")}  ${pc.dim("░█   █░")}     
  ${pc.dim("░░███░░")}  ${pc.yellow("░░█░█░█░░")}  ${pc.dim("░░███░░")}     
`;
export function printBrand() {
  console.log(OWO_ASCII);
}
