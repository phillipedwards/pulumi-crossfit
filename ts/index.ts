import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

export = async () => {
    const project = pulumi.getProject();
    const config = new pulumi.Config();
    const domainName = config.require("domainName");
    const siteBucket = new aws.s3.BucketV2(`${project}-bucket`, {
        // For BucketV2, the website configuration is specified differently.
        // You specify an array of website configurations.
        // Since we are creating a bucket meant for a website, we specify a single website block.
        // Refer to the AWS documentation for more detailed configurations you can apply here.
        websites: [{
            indexDocument: "index.html", // Your site's index document
            errorDocument: "404.html", // Custom error document
        }],
    });

    // Provision an ACM certificate for your domain, you need to control the DNS records to validate the certificate.
    const certificate = await aws.acm.getCertificate({
        domain: domainName,
        statuses: ["ISSUED"],
    });

    // Construct the CloudFront Distribution to serve content from S3 bucket over SSL.
    const siteDistribution = new aws.cloudfront.Distribution(`${project}-siteDistribution`, {
        enabled: true,
        origins: [{
            originId: siteBucket.arn,
            domainName: siteBucket.bucketRegionalDomainName,
            customOriginConfig: {
                originProtocolPolicy: "http-only", // because the bucket is only configured to serve over HTTP
                httpPort: 80,
                httpsPort: 443,
                originSslProtocols: ["TLSv1.2"],
            },
        }],
        defaultRootObject: "index.html",
        defaultCacheBehavior: {
            targetOriginId: siteBucket.arn,
            viewerProtocolPolicy: "redirect-to-https", // Enforce HTTPS
            allowedMethods: ["GET", "HEAD"],
            cachedMethods: ["GET", "HEAD"],
            forwardedValues: {
                queryString: false,
                cookies: {
                    forward: "none",
                },
            },
            minTtl: 0,
            defaultTtl: 3600,
            maxTtl: 86400,
        },
        priceClass: "PriceClass_100",
        customErrorResponses: [{
            errorCode: 404,
            responseCode: 404,
            responsePagePath: "/404.html",
        }],
        viewerCertificate: {
            acmCertificateArn: certificate.arn, // Reference to ACM certificate
            sslSupportMethod: "sni-only",
            minimumProtocolVersion: "TLSv1.2_2019",
        },
        restrictions: {
            geoRestriction: {
                restrictionType: "none",
            },
        },
        tags: {
            Name: "my-site-distribution",
        },
    });

    // Update your S3 bucket policy to grant public read access to the bucket.
    new aws.s3.BucketPolicy(`${project}-siteBucketPolicy`, {
        bucket: siteBucket.id, // Reference to the bucket created above
        policy: siteBucket.arn.apply(arn => JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Principal: "*",
                Action: "s3:GetObject",
                Resource: `${arn}/*`, // Allow access to all objects
            }],
        })),
    });

    return {
        bucketName: siteBucket.id,
        bucketEndpoint: pulumi.interpolate`http://${siteBucket.bucketRegionalDomainName}`,
        distributionId: siteDistribution.id,
        distributionDomain: siteDistribution.domainName,
    }
};